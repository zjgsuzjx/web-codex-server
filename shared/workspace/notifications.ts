export interface SiteNotification {
  id: number;
  title: string;
  body: string;
  author: string;
  created: number;
  read: boolean;
}
export interface NotificationPage {
  version: string;
  items: SiteNotification[];
  unread: number;
  nextCursor: number | null;
  latest: number;
}

export interface NotificationSnapshot {
  version: string;
  all: NotificationPage;
  unread: NotificationPage;
}
