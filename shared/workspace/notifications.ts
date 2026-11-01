export interface SiteNotification {
  id: number;
  title: string;
  body: string;
  author: string;
  created: number;
  read: boolean;
}
export interface NotificationPage {
  items: SiteNotification[];
  unread: number;
  nextCursor: number | null;
  latest: number;
}
