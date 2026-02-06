import { useState } from "react";

interface ApiKeyPromptProps {
  onSubmit: (key: string) => void;
}

export default function ApiKeyPrompt({ onSubmit }: ApiKeyPromptProps) {
  const [key, setKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <div className="api-key-overlay">
      <div className="api-key-modal">
        <h1>BridgeView AIS</h1>
        <h2>Blue Water Bridge Ship Tracker</h2>
        <p>
          Track vessels approaching the Blue Water Bridge between Sarnia, ON and
          Port Huron, MI in real-time using AIS data.
        </p>
        <p>
          To get started, enter your{" "}
          <a href="https://aisstream.io" target="_blank" rel="noopener noreferrer">
            aisstream.io
          </a>{" "}
          API key. Registration is free.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enter your aisstream.io API key"
            autoFocus
          />
          <button type="submit" disabled={!key.trim()}>
            Start Tracking
          </button>
        </form>
      </div>
    </div>
  );
}
