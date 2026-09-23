# Historical model normalization migration

The CLI now normalizes these names for new clanks, but historical rows still appear as separate models on the Top Models page and on [kodisha's profile](https://clankerlog.ai/kodisha). The backend needs a migration for existing data.

| Stored model name       | Canonical model name |
| ----------------------- | -------------------- |
| `GPT-5.6 Sol`           | `gpt-5.6-sol`        |
| `GPT-6 Sol`             | `gpt-6-sol`          |
| `cursor-grok-4.6-high`  | `grok-4.6`           |
| `cursor-grok-4.6-xhigh` | `grok-4.6`           |

Cursor identifies `grok-4.6` as the model and `high`/`xhigh` as effort levels. Check for other historical `cursor-grok-4.6-{low,medium,high,xhigh}` rows, including `-fast` variants, and merge them into `grok-4.6` too.

Write an idempotent migration for the backend's stored clanks and any model-based rollups that feed Top Models and profiles. Merge counts when a canonical bucket already exists; preserve total clank counts and other dimensions. Verify the before/after totals and that repeated execution makes no further changes. Do not change agent names or unrelated model slugs.

The CLI change is in `src/model.ts`; the Pi extension now sends the model ID first in `src/pi-hook.ts`. Those changes affect future clanks after the updated CLI is installed. This migration is for already ingested data.

Sources: [Cursor Grok 4.6 model documentation](https://prod.cursor.com/docs/models/grok-4-6); [OpenAI SDK model IDs](https://github.com/openai/openai-go/blob/main/aliases.go).
