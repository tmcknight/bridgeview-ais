import type { Notification } from "../hooks/useAISStream";

interface NotificationPanelProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
  onClear: () => void;
}

export default function NotificationPanel({
  notifications,
  onDismiss,
  onClear,
}: NotificationPanelProps) {
  const active = notifications.filter((n) => !n.dismissed);

  if (active.length === 0) return null;

  return (
    <div className="notification-panel">
      <div className="notification-header">
        <h3>Notifications ({active.length})</h3>
        <button className="clear-btn" onClick={onClear}>
          Clear all
        </button>
      </div>
      <div className="notification-list">
        {active.slice(0, 10).map((n) => (
          <div key={n.id} className={`notification-item ${n.type}`}>
            <div className="notification-content">
              <div className="notification-title">{n.shipName}</div>
              <div className="notification-message">{n.message}</div>
              <div className="notification-time">
                {n.timestamp.toLocaleTimeString()}
              </div>
            </div>
            <button
              className="dismiss-btn"
              onClick={() => onDismiss(n.id)}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
