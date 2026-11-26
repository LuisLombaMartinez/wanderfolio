# Floci for the local stack, and no fake-auth mode

Agents have no AWS credentials, so local development and e2e need an AWS stand-in. We deploy the same CDK app to Floci (a free, MIT-licensed AWS emulator) rather than LocalStack, whose free tier is gated, or hand-rolled mocks. Because Floci emulates Cognito, login works locally the same way as in prod. So the backend has no "local auth" switch that could ever be turned on in prod. Where Floci behaves differently from AWS (most likely IAM or S3 → EventBridge events), tests work around it and production code stays the same.

## Considered Options

- **A fake login accepted only in an explicit local mode, guarded by a CI check.** Rejected: an auth bypass compiled into the server is a risk that the guard has to keep catching forever.
