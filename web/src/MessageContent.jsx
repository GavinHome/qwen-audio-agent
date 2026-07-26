import { Fragment, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const MEDIA_IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(\?.*)?$/i
const MEDIA_AUDIO = /\.(mp3|wav|ogg|m4a|aac|flac|opus)(\?.*)?$/i
const MEDIA_VIDEO = /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i

function isSafeUrl(href) {
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function ImageEmbed({ src, alt }) {
  if (!src || !isSafeUrl(src)) return <span>{alt || src}</span>
  return (
    <a href={src} target="_blank" rel="noopener noreferrer">
      <img
        src={src}
        alt={alt || ''}
        loading="lazy"
        className="media-image"
      />
    </a>
  )
}

function AudioEmbed({ src }) {
  if (!src || !isSafeUrl(src)) return <span>{src}</span>
  return <audio controls preload="none" src={src} className="media-audio" />
}

function VideoEmbed({ src }) {
  if (!src || !isSafeUrl(src)) return <span>{src}</span>
  return (
    <video controls preload="none" src={src} className="media-video">
      <track kind="captions" />
    </video>
  )
}

function detectMediaType(href) {
  if (MEDIA_IMAGE.test(href)) return 'image'
  if (MEDIA_AUDIO.test(href)) return 'audio'
  if (MEDIA_VIDEO.test(href)) return 'video'
  return null
}

const mdComponents = {
  p: ({ children }) => <p>{children}</p>,
  img: ({ src, alt }) => {
    if (MEDIA_AUDIO.test(src || '')) return <AudioEmbed src={src} />
    if (MEDIA_VIDEO.test(src || '')) return <VideoEmbed src={src} />
    return <ImageEmbed src={src} alt={alt} />
  },
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>
    const mediaType = detectMediaType(href)
    if (mediaType === 'image') return <ImageEmbed src={href} alt={String(children)} />
    if (mediaType === 'audio') return <AudioEmbed src={href} />
    if (mediaType === 'video') return <VideoEmbed src={href} />
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    )
  },
  pre: ({ children }) => <>{children}</>,
  code: ({ node, className, children, ...rest }) => {
    if (className?.startsWith('language-')) {
      return <pre className="code-block"><code className={className}>{children}</code></pre>
    }
    return <code className="inline-code" {...rest}>{children}</code>
  },
  table: ({ children }) => (
    <div className="table-wrap"><table>{children}</table></div>
  ),
}

function MessageContent({ role, content, live }) {
  if (role === 'user') {
    return <div className="message-body">{content}</div>
  }

  if (!content) {
    return live ? <div className="message-body streaming-empty">…</div> : null
  }

  return (
    <div className="message-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MessageContent)
