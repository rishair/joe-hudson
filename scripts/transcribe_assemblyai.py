#!/usr/bin/env python3
"""Bulk transcribe all audio files using AssemblyAI with speaker diarization."""

import assemblyai as aai
import os, sys, time, json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Config
TRANSCRIPTS_DIR = Path("transcripts")
TRACKING_FILE = Path("meta/raw/transcribed_assemblyai.json")
MAX_CONCURRENT = 5  # AssemblyAI handles parallelism server-side; this is for submission

def find_audio_files():
    """Find all audio files in transcripts/ that don't yet have a transcript.md."""
    audio_extensions = {".mp3", ".m4a", ".opus", ".webm", ".wav", ".ogg"}
    results = []
    for dirpath, _, filenames in os.walk(TRANSCRIPTS_DIR):
        dirpath = Path(dirpath)
        transcript_path = dirpath / "transcript.md"
        if transcript_path.exists():
            continue  # Already transcribed
        for f in filenames:
            if Path(f).suffix.lower() in audio_extensions:
                results.append((dirpath / f, transcript_path))
                break  # One audio file per directory
    return results

def transcribe_file(audio_path, transcript_path, config):
    """Transcribe a single file and save result."""
    try:
        transcriber = aai.Transcriber(config=config)
        transcript = transcriber.transcribe(str(audio_path))

        if transcript.status == aai.TranscriptStatus.error:
            return str(audio_path), "error", transcript.error

        # Save utterance data with timestamps as JSON (for voiceprint relabeling)
        utterances_path = transcript_path.parent / "utterances.json"
        if transcript.utterances:
            utterance_data = [
                {"speaker": utt.speaker, "text": utt.text,
                 "start": utt.start, "end": utt.end}
                for utt in transcript.utterances
            ]
            with open(utterances_path, "w") as uf:
                json.dump(utterance_data, uf, indent=2)

        # Format transcript with speaker labels
        with open(transcript_path, "w") as out:
            out.write("# Transcript\n\n")
            if transcript.utterances:
                for utt in transcript.utterances:
                    out.write(f"**Speaker {utt.speaker}:** {utt.text}\n\n")
            elif transcript.text:
                out.write(transcript.text)
            else:
                out.write("(empty transcript)\n")

        words = len((transcript.text or "").split())
        speakers = set(u.speaker for u in (transcript.utterances or []))
        return str(audio_path), "success", f"{words} words, speakers: {speakers}"
    except Exception as e:
        return str(audio_path), "exception", str(e)

def main():
    aai.settings.api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not aai.settings.api_key:
        print("ERROR: ASSEMBLYAI_API_KEY not set. Run: source .env")
        sys.exit(1)

    config = aai.TranscriptionConfig(
        speech_models=["universal-3-pro", "universal-2"],
        speaker_labels=True,
    )

    files = find_audio_files()
    print(f"Found {len(files)} audio files without transcripts")

    if not files:
        print("Nothing to transcribe!")
        return

    # Load tracking
    tracking = {}
    if TRACKING_FILE.exists():
        tracking = json.loads(TRACKING_FILE.read_text())

    succeeded = 0
    failed = 0
    start_time = time.time()

    # Process with thread pool for parallel submission
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT) as executor:
        futures = {}
        for audio_path, transcript_path in files:
            future = executor.submit(transcribe_file, audio_path, transcript_path, config)
            futures[future] = (audio_path, transcript_path)

        for i, future in enumerate(as_completed(futures), 1):
            path, status, detail = future.result()
            elapsed = time.time() - start_time

            if status == "success":
                succeeded += 1
                tracking[path] = {"status": "success", "detail": detail, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                print(f"[{i}/{len(files)}] OK: {Path(path).parent.name} | {detail} | {elapsed:.0f}s elapsed")
            else:
                failed += 1
                tracking[path] = {"status": status, "detail": detail, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
                print(f"[{i}/{len(files)}] FAIL: {Path(path).parent.name} | {status}: {detail}")

            # Save tracking periodically
            if i % 10 == 0:
                TRACKING_FILE.write_text(json.dumps(tracking, indent=2))

    # Final save
    TRACKING_FILE.write_text(json.dumps(tracking, indent=2))

    total_time = time.time() - start_time
    print(f"\nDone! {succeeded} succeeded, {failed} failed, {total_time:.0f}s total ({total_time/60:.1f} min)")

if __name__ == "__main__":
    main()
