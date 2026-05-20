#!/usr/bin/env bash
# sync.sh — Idempotent sync for Art of Accomplishment content
#
# Downloads new YouTube videos and podcast episodes, transcribes them
# with AssemblyAI, and relabels speakers using Joe Hudson's voiceprint.
#
# Usage:
#   ./sync.sh              Run full sync (download + transcribe + relabel)
#   ./sync.sh download     Download only (skip transcription)
#   ./sync.sh transcribe   Transcribe only (skip downloads)
#   ./sync.sh relabel      Relabel speakers only
#   ./sync.sh --help       Show this help
#
# Idempotency:
#   - YouTube: yt-dlp's --download-archive skips already-downloaded videos
#   - Podcast: skips episodes whose directory already exists
#   - Transcription: skips directories that already have transcript.md
#   - Relabeling: skips transcripts already containing "Joe Hudson"
#
# Requirements:
#   - yt-dlp, ffmpeg, curl
#   - .env with ASSEMBLYAI_API_KEY and HF_TOKEN
#   - .venv with assemblyai, speechbrain, torch installed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment
if [[ -f .env ]]; then
    source .env
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[sync]${NC} $1"; }
warn() { echo -e "${YELLOW}[sync]${NC} $1"; }
err() { echo -e "${RED}[sync]${NC} $1" >&2; }

# ─── Stage 1: YouTube Download ───────────────────────────────────────────────

sync_youtube() {
    log "Stage 1: YouTube sync"

    if ! command -v yt-dlp &>/dev/null; then
        err "yt-dlp not found. Install with: brew install yt-dlp"
        return 1
    fi

    local before=$(wc -l < archive.txt 2>/dev/null || echo 0)

    yt-dlp -x --audio-format mp3 --embed-metadata \
        --output "transcripts/%(upload_date>%Y-%m-%d|)s_%(title)s/%(title)s.%(ext)s" \
        --download-archive archive.txt \
        --sleep-interval 3 --max-sleep-interval 10 \
        --write-info-json \
        "https://www.youtube.com/@ArtofAccomplishment/videos" 2>&1 \
        | grep -E "^\[download\] (Downloading|Destination|Finished)" || true

    local after=$(wc -l < archive.txt 2>/dev/null || echo 0)
    local new=$((after - before))

    if [[ $new -eq 0 ]]; then
        log "YouTube: no new videos"
    else
        log "YouTube: downloaded $new new video(s)"
    fi
}

# ─── Stage 2: Podcast Download ───────────────────────────────────────────────

sync_podcast() {
    log "Stage 2: Podcast sync"

    # Fetch current episode list from iTunes API
    local tmp_episodes=$(mktemp)
    curl -sL "https://itunes.apple.com/lookup?id=1540650504&media=podcast&entity=podcastEpisode&limit=200" \
        | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('results', []):
    if r.get('wrapperType') == 'podcastEpisode':
        date = r.get('releaseDate', '')[:10]
        title = r.get('trackName', '')
        dur = r.get('trackTimeMillis', 0)
        url = r.get('episodeUrl', '')
        if url:
            print(f'{date}\t{title}\t{dur}\t{url}')
" > "$tmp_episodes"

    local total=$(wc -l < "$tmp_episodes")
    local new=0

    while IFS=$'\t' read -r date title duration_ms url; do
        local safetitle=$(echo "$title" | sed 's/[\/:]/-/g' | cut -c1-80)
        local dir="transcripts/${date}_${safetitle}"

        if [[ -d "$dir" ]]; then
            continue
        fi

        mkdir -p "$dir"
        log "  Downloading: $safetitle"
        curl -sL -o "$dir/$safetitle.mp3" "$url"
        new=$((new + 1))
        sleep 1
    done < "$tmp_episodes"

    rm -f "$tmp_episodes"

    if [[ $new -eq 0 ]]; then
        log "Podcast: no new episodes (${total} in feed)"
    else
        log "Podcast: downloaded $new new episode(s)"
    fi
}

# ─── Stage 3: Transcribe ─────────────────────────────────────────────────────

sync_transcribe() {
    log "Stage 3: Transcribe new files"

    if [[ -z "${ASSEMBLYAI_API_KEY:-}" ]]; then
        err "ASSEMBLYAI_API_KEY not set. Add to .env"
        return 1
    fi

    if [[ ! -d .venv ]]; then
        err ".venv not found. Set up Python environment first."
        return 1
    fi

    # Run the transcription script (it skips existing transcript.md files)
    .venv/bin/python scripts/transcribe_assemblyai.py
}

# ─── Stage 4: Relabel Speakers ───────────────────────────────────────────────

sync_relabel() {
    log "Stage 4: Relabel speakers with voiceprint"

    if [[ ! -f meta/raw/joe-hudson-voiceprint.npy ]]; then
        err "Voiceprint not found at meta/raw/joe-hudson-voiceprint.npy"
        return 1
    fi

    if [[ ! -d .venv ]]; then
        err ".venv not found. Set up Python environment first."
        return 1
    fi

    .venv/bin/python scripts/relabel_speakers.py
}

# ─── Main ─────────────────────────────────────────────────────────────────────

show_help() {
    head -17 "$0" | tail -15 | sed 's/^# //' | sed 's/^#//'
}

main() {
    local mode="${1:-all}"

    case "$mode" in
        --help|-h)
            show_help
            ;;
        download)
            sync_youtube
            sync_podcast
            ;;
        transcribe)
            sync_transcribe
            ;;
        relabel)
            sync_relabel
            ;;
        all)
            sync_youtube
            sync_podcast
            sync_transcribe
            sync_relabel
            log "Sync complete."
            ;;
        *)
            err "Unknown mode: $mode"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
