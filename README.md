# hopper

**Line up the work, and your agents take it from there.**

```
██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗██████╗
██║  ██║██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗     ████    ████
███████║██║   ██║██████╔╝██████╔╝█████╗  ██████╔╝  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
██╔══██║██║   ██║██╔═══╝ ██╔═══╝ ██╔══╝  ██╔══██╗   ▀▀▀▄▄▄    ▄▄▄▀▀▀
██║  ██║╚██████╔╝██║     ██║     ███████╗██║  ██║        ▀█  █▀
╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝     ╚══════╝╚═╝  ╚═╝          ▀▀
v0.2.0

Line up the work, and your agents take it from there.
Feeds your queued tasks to agents, a few at a time, as they become ready.

  ▸ Page      https://hopper.example.com/
  ▸ API       https://hopper.example.com/queue
```

You queue tasks from [waypoint](https://github.com/dakotacolorado/waypoint), in
the order you want them done, and set how many may run at once. Every 30
seconds hopper takes the next queued task that waypoint says is ready (open,
nothing it depends on still open, nobody assigned), asks
[agency](https://github.com/dakotacolorado/agency) for an agent on it (an
`implementer` unless you queued it with another role) with a brief built from
the task, and assigns the task to that agent. agency still decides when each
agent actually starts, by usage and room on a host. A task hopper started counts
against the limit until waypoint shows it `done` or `cancelled`.

A task's `metadata.hostLabels` in waypoint, a list of agency host labels,
becomes its request's host labels, so its agent starts only on a host carrying
them all; a task whose `hostLabels` is not such a list waits, saying why.

A task's `metadata.difficulty` (1 easy, 2 medium, 3 hard) becomes its worker's
capability; without one agency uses the role's default, and a task whose
`difficulty` is not 1, 2 or 3 waits, saying why.

## Run it

Node 24 or later:

```sh
HOPPER_TOKEN=… WAYPOINT_URL=… WAYPOINT_TOKEN=… AGENCY_URL=… AGENCY_TOKEN=… node src/cli.ts
```

## Configure it

| Environment | Default | What it does |
| --- | --- | --- |
| `HOPPER_TOKEN` | required | the bearer token every call but `/health` and the page presents |
| `WAYPOINT_URL`, `WAYPOINT_TOKEN` | required | where tasks are read and assigned |
| `AGENCY_URL`, `AGENCY_TOKEN` | required | where agents are asked for |
| `HOPPER_DB` | `~/.local/share/hopper/hopper.db` | its SQLite file |
| `HOPPER_HOST`, `HOPPER_PORT` | `127.0.0.1`, `5000` | where it listens |
| `HOPPER_EVERY` | `30` | seconds between looks |

## Use it

The page at `/` does all of this. From a script, send
`Authorization: Bearer $HOPPER_TOKEN`:

| | |
| --- | --- |
| `GET /health` | `{ok, version, commit}`, no token |
| `GET /queue` | `{limit, entries}`: queued first in order, then started, finished and dropped, each with why it waits |
| `POST /queue` `{taskId, role?, before?}` | queue a task at the back, or before another queued one; queuing it again moves it |
| `DELETE /queue/{taskId}` | take a queued task out |
| `PUT /limit` `{limit}` | how many it keeps running at once (0–50; 0 pauses it) |
| `POST /tick` | look now |

Queue a task, with `HOPPER_URL` set to its address:

```sh
curl -X POST "$HOPPER_URL/queue" -H "Authorization: Bearer $HOPPER_TOKEN" \
  -H 'content-type: application/json' -d '{"taskId": "<task id>"}'
```

## Develop it

```sh
npm install
npm test
npm run typecheck
```

## License

MIT. See [LICENSE](./LICENSE).
