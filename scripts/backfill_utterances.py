#!/usr/bin/env python3
"""Backfill utterances.json for episodes that have transcript.md but no utterances.json.
Re-submits audio to AssemblyAI to get the structured utterance data."""

import assemblyai as aai
import os, sys, time, json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

TRANSCRIPTS_DIR = Path("transcripts")
MAX_CONCURRENT = 5

def find_missing_utterances():
    """Find directories with transcript.md but no utterances.json."""
    audio_extensions = {".mp3", ".m4a", ".opus", ".webm", ".wav", ".ogg"}
    results = []
    for dirpath, _, filenames in os.walk(TRANSCRIPTS_DIR):
        dirpath = Path(dirpath)
        if not (dirpath / "transcript.md").exists():
            continue
        if (dirpath / "utterances.json").exists():
            continue
        for f in filenames:
            if Path(f).suffix.lower() in audio_extensions:
                results.append(dirpath / f)
                break
    return results

def backfill_one(audio_path, config):
    """Re-transcribe to get utterances, save only utterances.json + update transcript.md."""
    try:
        transcriber = aai.Transcriber(config=config)
        transcript = transcriber.transcribe(str(audio_path))

        if transcript.status == aai.TranscriptStatus.error:
            return str(audio_path), "error", transcript.error

        dirpath = audio_path.parent

        # Save utterances
        if transcript.utterances:
            utterance_data = [
                {"speaker": utt.speaker, "text": utt.text,
                 "start": utt.start, "end": utt.end}
                for utt in transcript.utterances
            ]
            with open(dirpath / "utterances.json", "w") as uf:
                json.dump(utterance_data, uf, indent=2)

            # Also update transcript.md with speaker labels
            with open(dirpath / "transcript.md", "w") as out:
                out.write("# Transcript\n\n")
                for utt in transcript.utterances:
                    out.write(f"**Speaker {utt.speaker}:** {utt.text}\n\n")

        speakers = set(u.speaker for u in (transcript.utterances or []))
        return str(audio_path), "success", f"speakers: {speakers}"
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

    files = find_missing_utterances()
    print(f"Found {len(files)} episodes needing utterances.json backfill")

    if not files:
        print("Nothing to backfill!")
        return

    succeeded = 0
    failed = 0
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT) as executor:
        futures = {executor.submit(backfill_one, f, config): f for f in files}

        for i, future in enumerate(as_completed(futures), 1):
            path, status, detail = future.result()
            elapsed = time.time() - start_time
            if status == "success":
                succeeded += 1
                print(f"[{i}/{len(files)}] OK: {Path(path).parent.name} | {detail} | {elapsed:.0f}s")
            else:
                failed += 1
                print(f"[{i}/{len(files)}] FAIL: {Path(path).parent.name} | {status}: {detail}")

    total_time = time.time() - start_time
    print(f"\nDone! {succeeded} succeeded, {failed} failed, {total_time:.0f}s ({total_time/60:.1f} min)")

if __name__ == "__main__":
    main()
