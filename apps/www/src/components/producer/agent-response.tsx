import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./agent-response.css";

export function AgentResponse({ text }: { text: string }) {
  return <div className="ai-chat-answer">
    <span className="producer-sr-only">Banger: </span>
    <div className="agent-response">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
        a: ({ href, children, title, id }) => href
          ? <a href={href} id={id} title={title} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a>
          : <span>{children}</span>,
        // Replies are prose; avoid fetching remote images supplied by a model.
        img: ({ alt }) => <span>{alt}</span>,
        table: ({ children }) => <div className="agent-response-table" tabIndex={0} role="region" aria-label="Response table"><table>{children}</table></div>,
      }}>{text}</Markdown>
    </div>
  </div>;
}
