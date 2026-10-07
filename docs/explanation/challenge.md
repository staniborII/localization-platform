# Challenge

Bundesliga source video needs to reach fans, broadcasters, and partners in more than one language. The case study asks for an AWS architecture that transcribes speech, translates it, and produces subtitle files. The graded work is the design: diagrams, decision records, the workflow, and the trade-offs. A working CDK pipeline is optional and comes after those artifacts.

The sample files do not match the brief's assumption of a German-only source. Highlights and the interview are English. The feature mixes German and English and has several speakers. The pipeline therefore accepts English, German, or both on every profile, instead of hard-coding one source. Subtitle files are English, German, and Spanish, which are the languages the reviewers named. The minimum they asked for was one of those.

The client is a static site for trying the flow: upload a video, watch job status, open finished jobs, and read the reason when a job fails. On CloudFront it calls `/api/uploads` and `/api/jobs` on the same hostname. A local `next dev` server does not have that API.
