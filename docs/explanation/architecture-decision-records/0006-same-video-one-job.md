# 0006. The same video is one job, up to 5 GB

## Status

Accepted

## Context

The file name is not an identity. Two different videos can share a name, and a second upload of the same bytes used to get a new object key and a new job. Reviewers also have a file of about 2.11 GB. A single S3 PUT accepts at most 5 GiB. Above that, S3 requires a multipart upload.

## Decision

For a single PUT of at most 5 GiB, the video's identity is the SHA-256 of the whole file, the object size, the profile, and the sorted subtitle languages. The web client hashes the file in chunks and sends the hash, the size, and the profile. The presign function looks up that identity and, when a job already exists, returns that job and does not sign a new PUT. Otherwise it signs a PUT that asks S3 to store and check the SHA-256. The starter repeats the lookup with a conditional write, so two uploads that arrive together become one job. The web client and the presign function both refuse a file over 5 GiB.

## Alternatives

- The file name. Two videos can share it, and a second upload of one video would still look new.
- The object etag. For one PutObject with SSE-S3 the etag is an MD5. A multipart etag is not a hash of the whole file, so it cannot be the identity once uploads grow past one part.
- SHA-256 of a multipart upload. That checksum is of the parts. The same file can hash differently when the part boundaries change.

## Trade-off

The web client has to read the whole file before the upload starts. A person who sends someone else's hash is shown that job. There is no login on this web client, so that is the same trust as requesting any job id. S3 still rejects a PUT whose bytes do not match the signed checksum, so a claimed hash is not proof of a new object.

Files over 5 GiB are refused. The later path, not built, is a multipart upload identified by CRC-64/NVME with checksum type `FULL_OBJECT`. That checksum does not depend on part size. It would be computed in the web client, signed on the complete-multipart call by the presign function, and read by the starter into the same lock.

## Cost

The web client computes the hash. The lock is one extra DynamoDB item, billed as a write and a strongly consistent read. There is no standing charge. A multipart upload would add S3 request charges per part and is not on this path.

## Failure

A file over 5 GiB is rejected in the web client and again by the presign function, with a message that one upload can be at most 5 GB. An object that arrives without a full-file checksum is stored as failed and does not start. The reason is on the job row.
