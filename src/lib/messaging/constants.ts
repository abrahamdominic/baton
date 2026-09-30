/**
 * How many messages the server renders into a thread on first paint.
 *
 * The window holds the *newest* messages; older ones are fetched on demand via
 * the `beforeId` cursor in `listMessagesAction`. Rendering the oldest N instead
 * is what made a long thread open on its beginning with every recent message
 * missing.
 */
export const MESSAGE_WINDOW = 60;

/** How many messages a single poll tick asks for. */
export const POLL_BATCH = 30;
