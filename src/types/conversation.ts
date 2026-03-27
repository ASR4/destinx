export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageType = 'text' | 'interactive' | 'media' | 'location';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  messageType: MessageType;
  whatsappMessageId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type ConversationStatus =
  | 'active'
  | 'planning'
  | 'booking'
  | 'completed'
  | 'archived';

export interface ConversationState {
  id: string;
  userId: string;
  status: ConversationStatus;
  tripId?: string;
  context: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type Intent =
  | 'new_trip'
  | 'modify_plan'
  | 'book'
  | 'question'
  | 'feedback'
  | 'greeting'
  | 'general'
  | 'opt_out';

export interface IntentClassification {
  intent: Intent;
  confidence: number;
  entities?: Record<string, string>;
}

export interface ContextWindow {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tokenCount: number;
}
