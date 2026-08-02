# Tape priority during comfort slider drag

The comfort slider keeps its thumb on the native animation-frame path, while palette preview is throttled to roughly 30 FPS and deferred whenever the Tape/Footprint flow lane has pending work. During drag only surface CSS variables change; Canvas themes are committed once on pointer release.

The chart and flow render lanes from PR 116 are restored: charts use a bounded pre-paint lane and Tape, Tape ingest and Footprint use a bounded post-paint lane. Both remain on the browser main thread.
