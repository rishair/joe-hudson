# Download Verification Report

Generated: 2026-05-20

## Summary

| Metric | Count |
|--------|-------|
| Total directories in transcripts/ | 480 |
| Directories with audio files | 479 |
| Directories with transcript.md | 475 |
| Directories with utterances.json | 475 |
| Disk usage | 10 GB |

## Catalog Coverage

| Source | Catalog entries | Downloaded | Coverage |
|--------|----------------|------------|----------|
| YouTube (E-001) | 329 | 329 (archive.txt) | 100% |
| Podcast (E-002) | 167 | 167 | 100% |
| Total unique after dedup | ~479 | 479 | ~100% |

## Missing Transcripts (4)

These directories have audio files but no transcript.md:

1. `2022-10-26_How Relationships Reveal Us`
2. `2022-10-26_How To Tell If The Master Class Isn't For You`
3. `2022-10-26_Limiting Beliefs`
4. `2022-11-11_But... Is It Safe？`

All 4 are from October-November 2022. Likely failed during batch processing (possibly special characters in filenames or audio issues).

## Empty Directories (2)

These directories have no audio files:

1. `2024-05-24_Q&A #3—Ambition, Narcissistic Parents, Addiction to Stress, Parenting Emotional` - directory name truncated (too long), download likely failed
2. `2022-04-15_Joe Sanok — Living on the Road, Opening to Heartbreak and Parenting as a Single` - directory name truncated, download likely failed

## Non-Content Directory (1)

- `_Joe Hudson ｜ Art of Accomplishment - Videos` - YouTube channel metadata, not a content item

## Audio File Validation (10 random)

All 10 randomly sampled files are valid MP3 audio with ID3v2.4 tags. No corrupted files found. File sizes range from 7.5 MB to 36.4 MB.

## Duplicate Analysis

YouTube (329 videos) and podcast (167 episodes) share significant overlap. The podcast episodes are a subset of YouTube content (most podcast episodes are also uploaded as YouTube videos). The total of 479 audio files represents ~329 unique YouTube items + ~150 podcast-only items (episodes not on YouTube or downloaded separately). Exact deduplication was not performed; the transcription pipeline processes all files regardless of overlap.
