# AI Experiment Playbook

## What this is

AI experiments test hypotheses involving language models: prompt effectiveness, retrieval quality, eval scoring, model comparisons, coaching behavior. The output is empirical results with the exact configuration that produced them.

## How to execute

1. **Define the baseline.** What does the current state produce? Always measure before changing.
2. **Isolate one variable.** Change one thing at a time. If you change the prompt AND the retrieval AND the model, you learn nothing.
3. **Log everything reproducibly:**
   - The exact system prompt used (or a hash/path to it)
   - The model and parameters (temperature, max tokens)
   - The input (user message, retrieved context)
   - The raw output (full response, not summarized)
   - Cost and latency per call
4. **Run multiple samples.** A single conversation is an anecdote. Run 3-5 with the same config to see variance.
5. **Score with rubrics, not vibes.** Use the eval rubrics if they exist. If they don't, define what "good" and "bad" look like before running.

## Quality checklist

- [ ] Exact prompt/config is recorded (another agent could reproduce this)
- [ ] Raw outputs are saved, not just summaries
- [ ] Cost is tracked (per-call and total)
- [ ] Results are compared against a baseline or prior experiment
- [ ] Analysis distinguishes signal from noise (did you run enough samples?)
- [ ] Failure modes are documented, not just successes

## Tools and skills available

- Bash for API calls (curl) or running scripts
- Read/Write for prompt files and output logs
- Web search for model docs, API reference
- **`/ai_toolbelt`** — use this skill for generating embeddings locally (bge-small, MiniLM, Nomic models), batch embeddings, similarity calculations, and SQLite vector storage. Essential for retrieval experiments and embedding-based eval.
- **`/claude-api`** — use this skill when working with the Claude API or Anthropic SDK for prompt testing, model calls, and agent experiments.

## Resources to check

- Goal page Resources section for API keys (by env var name) and budget constraints
- `eval/` directory for existing rubrics and test infrastructure
- `coach/` directory for source material the AI is being tested against

## Common pitfalls

- **Scoring your own work.** If you wrote the prompt and you're judging the output, you're biased. Use structured rubrics or a separate judge model.
- **Cherry-picking.** Report ALL runs, not just the good ones. The failures are the signal.
- **Cost blindness.** A 300-call experiment at $0.10/call is $30. Know the budget before running.
- **Prompt length creep.** Track token counts. A prompt that works at 2K tokens may not be viable at 20K.
- **Confusing fluent with correct.** LLM outputs that sound good are not necessarily good coaching. Check against the `coach/` source material.
