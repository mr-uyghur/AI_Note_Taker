// IDs are string (hex ObjectId) in the shared layer.
// The web server converts to/from ObjectId at the DB boundary.

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscriptWord = {
  start: number;
  end: number;
  word: string;
};

export type Transcript = {
  full: string;
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
};

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string; // ISO 8601 — JSON-serializable
};

export type Conversation = {
  _id: string;
  createdAt: string; // ISO 8601
  title: string;
  messages: ConversationMessage[];
};

export type RecordingStatus = 'uploading' | 'transcribing' | 'ready' | 'failed';

export type Recording = {
  _id: string;
  title: string;
  createdAt: string; // ISO 8601
  durationSec: number;
  sizeBytes: number;
  videoKey: string;
  audioKey?: string;
  status: RecordingStatus;
  error?: string;
  transcript?: Transcript;
  share: {
    enabled: boolean;
    token: string | null;
  };
  conversations: Conversation[];
};
