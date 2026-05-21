# Wiki Index

## Goals

- [x] G-001 Download and transcribe all Art of Accomplishment content with speaker diarization
  - Sub-goals
    - [x] G-002 Discover and catalog all Joe Hudson / Art of Accomplishment content sources
      - Research
        - [x] R-001 What platforms and feeds host Art of Accomplishment content?
      - Experiments
        - [x] E-001 Use yt-dlp to extract full video list from the AoA YouTube channel
        - [x] E-002 Scrape AoA website podcast page for complete episode archive
        - [x] E-003 Use Listen Notes or podcast indexes to catalog guest appearances
        - [x] E-004 Check Vimeo account for unique content
    - [x] G-003 Download all source media files
      - Sub-goals
        - [x] G-005 Execute full bulk download of all content
          - Experiments
            - [x] E-010 Full YouTube channel audio download
            - [x] E-011 Full podcast episode audio download
            - [x] E-012 Download verification and gap report
      - Research
        - [x] R-003 How to bulk-download YouTube channels and podcast feeds in 2026
      - Experiments
        - [x] E-008 yt-dlp audio download from AoA YouTube channel
        - [x] E-009 Podcast episode download via iTunes API URLs
    - [x] G-004 Transcribe all media with speaker diarization
      - Research
        - [x] R-002 Current state of speech-to-text with speaker diarization tools
      - Experiments
        - [ ] E-005 WhisperX prototype on 2-3 episodes
        - [ ] E-006 Pyannote voiceprint speaker labeling for Joe Hudson
        - [ ] E-007 AssemblyAI comparison baseline
        - [x] E-013 Extract Joe Hudson voiceprint embedding
        - [x] E-014 AssemblyAI bulk transcription with diarization
        - [x] E-015 Post-process transcripts to relabel Speaker A/B as Joe Hudson vs Guest
        - [x] E-017 Build speaker voiceprint database and relabel all speakers by name
    - [ ] G-006 Repeatable idempotent sync system for all content
      - Experiments
        - [x] E-016 Build and test sync.sh idempotent pipeline
- [ ] G-007 Build Joe Hudson coaching compendium from all transcripts
  - Research
    - [x] R-004 Approaches to large-scale transcript concept extraction
    - [x] R-007 Survey transcripts to identify Joe Hudson's coaching taxonomy
  - Experiments
    - [x] E-018 Prototype compendium absorption on 5 transcripts

## Checkpoints

- 2026-05-20-153000
- 2026-05-20-034500
