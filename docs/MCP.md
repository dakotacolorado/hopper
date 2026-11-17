# hopper's MCP server

<!-- Generated from src/mcp.ts by `npm run spec`; do not edit. -->

hopper feeds queued [waypoint](https://github.com/dakotacolorado/waypoint) tasks to agents, a few at a time, as they become ready.
Agents that manage a plan use this server to queue its tasks, take them out, and set how many run at once.

Streamable HTTP at `/mcp`, stateless, answering JSON. Every request takes `Authorization: Bearer $HOPPER_TOKEN`, as the API does.
Each tool does what the API route of the same purpose does; a refusal comes back as the tool's error.

```json
{
  "mcpServers": {
    "hopper": {
      "type": "http",
      "url": "https://hopper.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${HOPPER_TOKEN}"
      }
    }
  }
}
```

## Instructions

What the server tells an agent when it connects:

> hopper: Feeds your queued tasks to agents, a few at a time, as they become ready.
>
> For agents that manage a plan: queue its tasks here and hopper starts an agent on each, once waypoint says the task is ready and there is room under the limit.
>
> - A queued task starts in queue order, but only when waypoint says it is ready (open, nothing it depends on still open, nobody assigned); until then its entry says why it waits.
> - The limit is how many of hopper's tasks run at once; a task counts against it until waypoint shows it done or cancelled. A higher limit spends more tokens; 0 pauses hopper.
> - hopper looks every 30 seconds; queue_task and set_limit also look at once.

## Tools

| Tool | Does | Reads only |
| --- | --- | --- |
| [`list_queue`](#list_queue) | List queue | yes |
| [`queue_task`](#queue_task) | Queue task |  |
| [`dequeue_task`](#dequeue_task) | Dequeue task |  |
| [`set_limit`](#set_limit) | Set limit |  |
| [`tick`](#tick) | Tick |  |

### list_queue

Returns the limit and every entry: queued ones first in order, then started, finished and dropped, each with its state and why it waits. hopper starts an agent on each queued task once waypoint says it is ready and there is room under the limit.

No input.

### queue_task

Queues a waypoint task at the back, or before another queued one; queuing a task again moves it. hopper starts an agent on it once waypoint says it is ready and there is room under the limit.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `taskId` | string | yes | The waypoint task's ID. |
| `role` | string |  | The role of the agent started on it. Default implementer. |
| `before` | string |  | The ID of a queued task to go in front of. Default: the back. |

### dequeue_task

Takes a queued task out of the queue, so no agent is started on it.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `taskId` | string | yes | The waypoint task's ID. |

### set_limit

Sets how many of hopper's tasks run at once, from 0 to 50; 0 pauses it. A higher limit starts more agents at once and so spends more tokens.

| Input | Type | Required | |
| --- | --- | --- | --- |
| `limit` | integer | yes | How many tasks may run at once. |

### tick

Looks at the queue now, rather than at the next tick, starting agents on tasks that are ready and fit under the limit. Returns the limit and entries.

No input.
