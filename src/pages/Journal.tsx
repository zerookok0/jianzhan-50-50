import { posts, getPost } from '../data/posts'
import { useDocumentMeta, useReveal } from '../lib/hooks'
import { AppLink, MediaImage } from '../components/ui/Media'
import type { ImageKey } from '../data/images'
import { ArrowRight } from '../components/ui/Icons'

export function Journal() {
  useDocumentMeta(
    'Journal — Glaze, Process and Collecting | JIANZHAN',
    'Essays and notes on reading Jian ware glazes, wood firing, care and collecting. Practical writing, no invented history.',
  )
  useReveal()

  return (
    <div className="journal-page">
      <header className="journal-hero shell">
        <p className="eyebrow reveal">Journal</p>
        <h1 className="display display--lg journal-hero__title reveal" data-delay="1">
          Notes from the studio
        </h1>
        <p className="lede reveal" data-delay="2">
          Short, practical writing on glaze, firing and living with these objects. Written by the
          studio; no guest authors are implied.
        </p>
      </header>

      <section className="shell journal-list" aria-label="Journal entries">
        {posts.map((post, i) => (
          <AppLink
            key={post.slug}
            href={`/journal/${post.slug}`}
            className={`jrow reveal ${i % 2 === 1 ? 'jrow--flip' : ''}`}
          >
            <div className="jrow__media">
              <MediaImage
                image={post.image as ImageKey}
                alt=""
                ratio={16 / 10}
                sizes="(min-width: 900px) 48vw, 92vw"
              />
            </div>
            <div className="jrow__body">
              <p className="meta">
                {post.kicker} · {post.readMinutes} min read
              </p>
              <h2 className="display display--sm jrow__title">{post.title}</h2>
              <p className="body">{post.excerpt}</p>
              <span className="btn btn--link jrow__more">
                Read entry
                <ArrowRight width={16} height={16} className="btn__arrow" />
              </span>
            </div>
          </AppLink>
        ))}
      </section>

      <section className="section section--tight">
        <div className="shell journal-cta">
          <p className="eyebrow">Looking for something?</p>
          <p className="body">
            The collection carries the objects themselves; the journal covers how to read them.
          </p>
          <AppLink href="/collection" className="btn btn--outline">
            Browse the collection
          </AppLink>
        </div>
      </section>
    </div>
  )
}

export function JournalPost({ slug }: { slug: string }) {
  const post = getPost(slug)
  useDocumentMeta(
    post ? `${post.title} — Journal | JIANZHAN` : 'Entry not found | JIANZHAN',
    post?.excerpt,
  )
  useReveal([slug])

  if (!post) {
    return (
      <div className="shell not-found-page">
        <p className="eyebrow">Not Found</p>
        <h1 className="display display--lg">This entry no longer exists</h1>
        <AppLink href="/journal" className="btn btn--outline">
          All journal entries
        </AppLink>
      </div>
    )
  }

  const others = posts.filter((p) => p.slug !== post.slug).slice(0, 2)

  return (
    <article className="post-page">
      <header className="post-hero">
        <div className="shell">
          <nav className="breadcrumb breadcrumb--light" aria-label="Breadcrumb">
            <AppLink href="/journal">Journal</AppLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{post.kicker}</span>
          </nav>
          <p className="eyebrow">{post.kicker}</p>
          <h1 className="display display--lg post-hero__title">{post.title}</h1>
          <p className="post-hero__meta">
            {new Date(post.date).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}{' '}
            · {post.readMinutes} min read
          </p>
        </div>
      </header>

      <div className="post-figure">
        <MediaImage
          image={post.image as ImageKey}
          alt=""
          ratio={21 / 9}
          sizes="100vw"
          priority
        />
      </div>

      <div className="shell post-body">
        {post.body.map((block, i) => (
          <section key={i} className="post-block reveal">
            {block.heading && <h2 className="post-block__h">{block.heading}</h2>}
            <p>{block.text}</p>
          </section>
        ))}

        <div className="post-foot reveal">
          <p className="meta">Published by the JIANZHAN studio</p>
          <AppLink href="/journal" className="btn btn--link">
            All entries
            <ArrowRight width={16} height={16} />
          </AppLink>
        </div>
      </div>

      <section className="section section--tight" aria-labelledby="more-posts">
        <div className="shell">
          <p className="eyebrow">Continue reading</p>
          <h2 id="more-posts" className="display display--sm journal-more-title">
            More from the journal
          </h2>
          <div className="journal-grid">
            {others.map((p, i) => (
              <AppLink key={p.slug} href={`/journal/${p.slug}`} className="jcard reveal" data-delay={i + 1}>
                <MediaImage image={p.image as ImageKey} alt="" ratio={16 / 10} sizes="(min-width: 900px) 40vw, 92vw" />
                <div className="jcard__body">
                  <p className="meta">
                    {p.kicker} · {p.readMinutes} min
                  </p>
                  <h3 className="jcard__title">{p.title}</h3>
                  <p className="jcard__excerpt">{p.excerpt}</p>
                </div>
              </AppLink>
            ))}
          </div>
        </div>
      </section>
    </article>
  )
}
