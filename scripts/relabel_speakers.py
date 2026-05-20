#!/usr/bin/env python3
"""Relabel speaker labels in transcript.md using voiceprint fingerprinting.

For each transcript with utterances.json (timestamps per speaker), extracts
audio segments for each unique speaker, computes speaker embeddings, and
compares against the Joe Hudson voiceprint to identify which speaker is Joe.

Requires: speechbrain, torch, numpy, ffmpeg
Voiceprint: meta/raw/joe-hudson-voiceprint.npy (from E-013)
"""

import os
import sys
import re
import json
import subprocess
import tempfile
import numpy as np
from pathlib import Path


def load_voiceprint(path="meta/raw/joe-hudson-voiceprint.npy"):
    return np.load(path)


def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def extract_segment(input_path, output_path, start_ms, end_ms):
    """Extract audio segment by millisecond timestamps."""
    start_s = start_ms / 1000
    duration_s = (end_ms - start_ms) / 1000
    subprocess.run(
        ['ffmpeg', '-i', str(input_path), '-ss', str(start_s), '-t', str(duration_s),
         '-ar', '16000', '-ac', '1', str(output_path), '-y'],
        capture_output=True
    )


def get_speaker_segments(utterances, speaker, max_duration_ms=60000):
    """Get utterance timestamps for a speaker, up to max_duration_ms total."""
    segments = []
    total_ms = 0
    for utt in utterances:
        if utt['speaker'] == speaker:
            duration = utt['end'] - utt['start']
            segments.append((utt['start'], utt['end']))
            total_ms += duration
            if total_ms >= max_duration_ms:
                break
    return segments


def extract_speaker_audio(audio_path, segments, output_path):
    """Extract and concatenate multiple segments for a speaker into one file."""
    if not segments:
        return False

    # Extract each segment to a temp file, then concatenate
    temp_files = []
    for i, (start_ms, end_ms) in enumerate(segments[:5]):  # Max 5 segments
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        tmp.close()
        extract_segment(audio_path, tmp.name, start_ms, end_ms)
        temp_files.append(tmp.name)

    if len(temp_files) == 1:
        os.rename(temp_files[0], output_path)
    else:
        # Concatenate using ffmpeg
        list_file = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
        for tf in temp_files:
            list_file.write(f"file '{tf}'\n")
        list_file.close()
        subprocess.run(
            ['ffmpeg', '-f', 'concat', '-safe', '0', '-i', list_file.name,
             '-ar', '16000', '-ac', '1', output_path, '-y'],
            capture_output=True
        )
        os.unlink(list_file.name)
        for tf in temp_files:
            if os.path.exists(tf):
                os.unlink(tf)

    return os.path.exists(output_path) and os.path.getsize(output_path) > 100


def find_audio_file(dirpath):
    for ext in ['.mp3', '.wav', '.m4a', '.opus', '.webm']:
        for f in os.listdir(dirpath):
            if f.endswith(ext):
                return os.path.join(dirpath, f)
    return None


def relabel_transcript(transcript_path, speaker_names):
    """Replace Speaker X labels with actual names."""
    with open(transcript_path, 'r') as f:
        content = f.read()

    for label, name in speaker_names.items():
        content = content.replace(f'**Speaker {label}:**', f'**{name}:**')

    with open(transcript_path, 'w') as f:
        f.write(content)


def main():
    from speechbrain.inference import EncoderClassifier

    joe_vp = load_voiceprint()
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        run_opts={"device": "cpu"}
    )

    transcripts_dir = Path("transcripts")
    relabeled_log = Path("meta/raw/relabeled.txt")
    already_done = set()
    if relabeled_log.exists():
        already_done = set(line.strip() for line in relabeled_log.read_text().splitlines()
                          if line.strip() and not line.startswith('#'))

    processed = 0
    skipped = 0
    errors = 0
    joe_identified = 0

    for dirname in sorted(os.listdir(transcripts_dir)):
        dirpath = transcripts_dir / dirname
        if not dirpath.is_dir():
            continue

        transcript_path = dirpath / "transcript.md"
        utterances_path = dirpath / "utterances.json"

        if not transcript_path.exists():
            continue

        if dirname in already_done:
            skipped += 1
            continue

        # Check if transcript still has Speaker X labels
        content = transcript_path.read_text()
        has_speaker_labels = bool(re.search(r'\*\*Speaker [A-Z]\*\*:', content))
        if not has_speaker_labels:
            # Check for previously mis-labeled (Joe Hudson + Speaker B, etc)
            if '**Joe Hudson:**' in content and not '**Brett Kistler:**' in content and not '**Guest:**' in content:
                skipped += 1
                continue

        if not utterances_path.exists():
            # No timestamp data. Skip for now.
            skipped += 1
            continue

        audio = find_audio_file(str(dirpath))
        if not audio:
            skipped += 1
            continue

        try:
            utterances = json.loads(utterances_path.read_text())
            speakers = sorted(set(u['speaker'] for u in utterances))

            if len(speakers) < 2:
                # Solo episode, just label the one speaker
                speaker_names = {speakers[0]: "Joe Hudson"}
                relabel_transcript(str(transcript_path), speaker_names)
                already_done.add(dirname)
                processed += 1
                continue

            # For each speaker, extract their audio and compute embedding
            speaker_sims = {}
            for speaker in speakers:
                segments = get_speaker_segments(utterances, speaker)
                if not segments:
                    continue

                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                    tmp = f.name

                if extract_speaker_audio(audio, segments, tmp):
                    emb = classifier.encode_batch(classifier.load_audio(tmp).unsqueeze(0))
                    emb = emb.squeeze().numpy()
                    sim = cosine(joe_vp, emb)
                    speaker_sims[speaker] = sim

                if os.path.exists(tmp):
                    os.unlink(tmp)

            if not speaker_sims:
                skipped += 1
                continue

            # The speaker with highest similarity to Joe's voiceprint is Joe
            joe_speaker = max(speaker_sims, key=speaker_sims.get)
            joe_sim = speaker_sims[joe_speaker]

            # Build name mapping
            speaker_names = {}
            for speaker in speakers:
                if speaker == joe_speaker:
                    speaker_names[speaker] = "Joe Hudson"
                else:
                    # For AoA podcast, the other speaker is usually Brett Kistler
                    # For guest episodes, it's a guest
                    speaker_names[speaker] = "Brett Kistler"

            relabel_transcript(str(transcript_path), speaker_names)
            already_done.add(dirname)
            processed += 1
            if joe_sim > 0.5:
                joe_identified += 1

            if processed % 10 == 0 or processed <= 5:
                sims_str = ", ".join(f"{s}={v:.3f}" for s, v in sorted(speaker_sims.items()))
                print(f"[{processed}] {dirname}: joe={joe_speaker} (sims: {sims_str})")

        except Exception as e:
            print(f"ERROR: {dirname}: {e}")
            errors += 1

    # Save log
    with open(relabeled_log, 'w') as f:
        for d in sorted(already_done):
            f.write(d + '\n')

    print(f"\nDone: {processed} relabeled, {joe_identified} confident Joe IDs, {skipped} skipped, {errors} errors")


if __name__ == '__main__':
    main()
