import type { ObjectId } from 'mongodb';

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
  createdAt: Date;
};

export type Conversation = {
  _id: ObjectId;
  createdAt: Date;
  title: string;
  messages: ConversationMessage[];
};

export type RecordingStatus = 'uploading' | 'transcribing' | 'ready' | 'failed';

export type Recording = {
  _id: ObjectId;
  title: string;
  createdAt: Date;
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
