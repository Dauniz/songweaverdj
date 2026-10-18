# Replace Songweaver’s deprecated text model

## Confirmed findings
- Current code uses **google/gemini-3.6-flash** for chat, road picking, taste synthesis, history learning, playlist hints, welcome guesses, Studio suggestions and the Crate Knows portrait.
- The workspace-aware Gateway catalog marks that model **deprecated**, with an expiration date of **19 November 2026, 00:00 UTC**. Recent production requests still succeeded; this is not evidence of a current outage.
- The catalog exposes no automatic replacement mapping for this model. No automatic redirect or post-expiration outage behavior has been confirmed; do not claim either.
- Voice transcription already uses **google/gemini-3.5-transcribe**, which is active with no listed expiration. Leave it unchanged.

## Recommended replacement
- Use **google/gemini-3-flash-preview** for the affected text calls. It is active, workspace-available, supports the same chat-completions surface and million-token context, and balances speed, quality and cost without introducing OpenAI or Anthropic text models.
- Its listed text rates are **$0.50 input / $3.00 output per million tokens**, versus **$0.75 / $3.75** for 3.6 Flash: approximately **33% lower input cost and 20% lower output cost**, for equal token usage. Actual credits and latency depend on request size and output.
- Both endpoints report **zero provider retention for chat-completions**. Workspace discovery confirms availability; it reports no enforced inference-region field.
- Flash Lite is cheaper but targeted at simpler extraction tasks; keep one balanced Flash model for the existing reasoning and tool workflows. Pro and image-oriented models cost more and are not a better fit here.
- The replacement is a preview model with an older knowledge cutoff, not a guaranteed quality upgrade. Check music selection and tool behavior before declaring the migration complete.

## What will stay the same
- Spotify connection, playback, queue order, finish/skip doors and session behavior.
- Existing Walrus memories, imported history and saved chat. No data migration or deletion.
- Prompts, selection rules, output limits, cancellation, application timers and stream behavior, except where the replacement’s documented request contract requires adaptation.
- No visual changes and no publishing.

## Technical implementation
This is more than a safe name-only replacement: eight affected modules currently mix raw Gateway requests with Vercel AI SDK calls, and the chat depends on streamed tool execution. Migrate only these deprecated-model calls through the required Gateway SDK while preserving their existing behavior.

1. Install `@lovable.dev/ai-gateway` in the project, generate the replacement model’s contracts, and load the generated type augmentation. Inspect its typed request fields and stream events before changing inference.
2. Replace affected non-streaming calls with `generateChatCompletion`, retaining JSON parsing, candidate validation, output budgets and existing fallbacks.
3. Adapt chat to `streamChatCompletion` while preserving the current UI-message stream, tool schemas, recommendation/memory tool execution, four-step bound, cancellation and completed-message persistence. Keep server-only credentials and authenticated boundaries.
4. Update the existing AI architecture rule and current README model description to match; leave historical plans alone.
5. If authoritative alias metadata becomes available, document it accurately; do not infer a redirect from successful requests.

## Verification and completion
- Add focused tests for JSON responses, invalid candidate rejection, streamed tool execution, cancellation, and no partial-message persistence. Run relevant existing picking and session-chat tests.
- Verify chat and six-song recommendations with synthetic fixtures and intercepted playback commands. **Never send Spotify commands or write taste memories on Isac’s account during testing.**
- Exercise a bounded, isolated model request to confirm the replacement contract, then check application diagnostics. Report any real-device playback behavior as unverified rather than changing it.
- Resolve the monitoring finding as fixed only after all affected executable references and their behavior have been verified.