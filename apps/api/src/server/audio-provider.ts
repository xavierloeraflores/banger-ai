/** An adapter must honor idempotencyKey, or implement lookup by that key before retrying submit. */
export interface AudioProvider {
  submit(input: { idempotencyKey: string; audio: Uint8Array; contentType: 'audio/wav' }): Promise<{ requestId: string }>;
  poll(requestId: string): Promise<{ status: 'processing'; progress: number } | { status: 'failed'; error: string } | { status: 'completed'; audio: ReadableStream<Uint8Array>; contentType: 'audio/mpeg' | 'audio/wav' }>;
}
// ElevenLabs operation and credentials will be wired here when that integration is implemented.
export function audioProvider(): AudioProvider | undefined { return undefined; }
