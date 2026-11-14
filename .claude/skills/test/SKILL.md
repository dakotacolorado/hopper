---
name: test
description: How to run hopper's checks. Use before submitting a change to hopper, and when reviewing one.
---

# Testing hopper

From the repo root, on Node 24, after `npm install`, each on its own, reading
its exit status, with every service variable unset so nothing reaches a live
one:

```sh
env -u HOPPER_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u AGENCY_URL -u AGENCY_TOKEN npm test
env -u HOPPER_TOKEN -u WAYPOINT_URL -u WAYPOINT_TOKEN -u AGENCY_URL -u AGENCY_TOKEN npm run typecheck
```
