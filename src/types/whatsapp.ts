export interface TwilioWebhookPayload {
  MessageSid: string;
  SmsSid: string;
  AccountSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  ProfileName?: string;
  WaId?: string;
  Latitude?: string;
  Longitude?: string;
  ButtonText?: string;
  ListId?: string;
}

export interface IncomingMessage {
  body: string;
  from: string;
  messageSid: string;
  numMedia: number;
  mediaUrl?: string;
  latitude?: number;
  longitude?: number;
  buttonPayload?: string;
  listSelection?: string;
}

export interface OutgoingTextMessage {
  to: string;
  body: string;
}

export interface ReplyButton {
  id: string;
  title: string;
}

export interface OutgoingButtonMessage {
  to: string;
  body: string;
  buttons: ReplyButton[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface OutgoingListMessage {
  to: string;
  body: string;
  buttonText: string;
  sections: ListSection[];
}

export interface OutgoingMediaMessage {
  to: string;
  mediaUrl: string;
  caption: string;
}
