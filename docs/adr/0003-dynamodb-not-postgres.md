# DynamoDB instead of Postgres

The original plan was Go + Postgres. On AWS, RDS Postgres is only free for 12 months (then about $13-15/month) and has to live in a VPC, which drags the Lambda into the VPC too. Aurora Serverless v2 can scale to zero but takes about 15 s to wake up, which is a bad first load on a phone. DynamoDB is always free at this size, needs no VPC and has no cold-start penalty, and the data's access patterns are few and known upfront (Trips by date, Photos by Trip, Pending Invitations by Invitee). So we use DynamoDB, with the table modelled around those access patterns.

## Consequences

- The Postgres tooling (`postgres-patterns`, `database-migrations`, the `database-reviewer` agent) was removed from the factory; DynamoDB design and review use the official `amazon-dynamodb` skill.
- A new access pattern can mean remodelling the table (a new index or a backfill), which needs more care than adding a SQL query.
