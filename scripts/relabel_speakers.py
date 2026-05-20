#!/usr/bin/env python3
"""Relabel speaker labels in transcript.md using voiceprint matching.

Matches each speaker against known voiceprints (Joe Hudson, Brett Kistler).
Unmatched speakers get labeled "Guest 1", "Guest 2", etc. within the episode.

Requires: speechbrain, torch, numpy, ffmpeg
Voiceprints: meta/raw/joe-hudson-voiceprint.npy, meta/raw/brett-kistler-voiceprint.npy
"""

import os
import re
import json
import subprocess
import tempfile
import numpy as np
from pathlib import Path

KNOWN_SPEAKERS = {
    "Joe Hudson": "meta/raw/joe-hudson-voiceprint.npy",
    "Brett Kistler": "meta/raw/brett-kistler-voiceprint.npy",
}
MATCH_THRESHOLD = 0.55  # cosine similarity above this = match


def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def extract_speaker_audio(audio_path, utterances, speaker, max_segs=5):
    segs = [(u['start'], u['end']) for u in utterances if u['speaker'] == speaker][:max_segs]
    if not segs:
        return None
    tmp_files = []
    for s, e in segs:
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        tmp.close()
        subprocess.run(
            ['ffmpeg', '-i', str(audio_path), '-ss', str(s/1000), '-t', str((e-s)/1000),
             '-ar', '16000', '-ac', '1', tmp.name, '-y'],
            capture_output=True
        )
        tmp_files.append(tmp.name)

    if len(tmp_files) > 1:
        lf = tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False)
        lf.close()
        with open(lf.name, 'w') as f:
            for tf in tmp_files:
                f.write(f"file '{tf}'\n")
        out = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        out.close()
        subprocess.run(
            ['ffmpeg', '-f', 'concat', '-safe', '0', '-i', lf.name,
             '-ar', '16000', '-ac', '1', out.name, '-y'],
            capture_output=True
        )
        os.unlink(lf.name)
        for tf in tmp_files:
            os.unlink(tf)
        return out.name
    else:
        return tmp_files[0]


def find_audio_file(dirpath):
    for f in os.listdir(dirpath):
        if f.endswith(('.mp3', '.wav', '.m4a')):
            return os.path.join(dirpath, f)
    return None


def relabel_transcript(transcript_path, speaker_map):
    """Replace Speaker X labels with names from speaker_map."""
    with open(transcript_path, 'r') as f:
        content = f.read()
    for label, name in speaker_map.items():
        content = content.replace(f'**Speaker {label}:**', f'**{name}:**')
    with open(transcript_path, 'w') as f:
        f.write(content)


def main():
    from speechbrain.inference import EncoderClassifier

    # Load known voiceprints
    voiceprints = {}
    for name, path in KNOWN_SPEAKERS.items():
        if os.path.exists(path):
            voiceprints[name] = np.load(path)
            print(f"Loaded voiceprint: {name}")

    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        run_opts={"device": "cpu"}
    )

    transcripts_dir = Path("transcripts")
    relabeled_log = Path("meta/raw/relabeled-v2.txt")
    already_done = set()
    if relabeled_log.exists():
        already_done = set(
            line.strip() for line in relabeled_log.read_text().splitlines()
            if line.strip() and not line.startswith('#')
        )

    processed = 0
    skipped = 0
    errors = 0

    for dirname in sorted(os.listdir(transcripts_dir)):
        dirpath = transcripts_dir / dirname
        if not dirpath.is_dir():
            continue

        transcript_path = dirpath / "transcript.md"
        utterances_path = dirpath / "utterances.json"

        if not transcript_path.exists() or not utterances_path.exists():
            continue

        if dirname in already_done:
            skipped += 1
            continue

        audio = find_audio_file(str(dirpath))
        if not audio:
            skipped += 1
            continue

        try:
            utterances = json.loads(utterances_path.read_text())
            speakers = sorted(set(u['speaker'] for u in utterances))

            # Compute embedding for each speaker
            speaker_embeddings = {}
            for spk in speakers:
                seg_audio = extract_speaker_audio(audio, utterances, spk)
                if not seg_audio:
                    continue
                emb = classifier.encode_batch(
                    classifier.load_audio(seg_audio).unsqueeze(0)
                ).squeeze().numpy()
                speaker_embeddings[spk] = emb
                os.unlink(seg_audio)

            # Match each speaker against known voiceprints
            speaker_map = {}
            used_names = set()
            guest_counter = 1

            # First pass: match known speakers (best match wins)
            for spk, emb in speaker_embeddings.items():
                best_name = None
                best_sim = MATCH_THRESHOLD
                for name, vp in voiceprints.items():
                    if name in used_names:
                        continue
                    sim = cosine(vp, emb)
                    if sim > best_sim:
                        best_sim = sim
                        best_name = name
                if best_name:
                    speaker_map[spk] = best_name
                    used_names.add(best_name)

            # Second pass: label remaining speakers as Guest N
            for spk in speakers:
                if spk not in speaker_map:
                    if len(speakers) == 1:
                        # Solo episode, likely Joe even if voiceprint didn't match well
                        speaker_map[spk] = "Joe Hudson"
                    else:
                        speaker_map[spk] = f"Guest {guest_counter}"
                        guest_counter += 1

            relabel_transcript(str(transcript_path), speaker_map)
            already_done.add(dirname)
            processed += 1

            if processed % 20 == 0 or processed <= 5:
                labels = ", ".join(f"{k}={v}" for k, v in sorted(speaker_map.items()))
                print(f"[{processed}] {dirname}: {labels}")

        except Exception as e:
            print(f"ERROR: {dirname}: {e}")
            errors += 1

    # Save log
    with open(relabeled_log, 'w') as f:
        for d in sorted(already_done):
            f.write(d + '\n')

    print(f"\nDone: {processed} relabeled, {skipped} skipped, {errors} errors")


if __name__ == '__main__':
    main()
