import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import { COMPANY, TEAM } from '../data/content.js'
import { PEOPLE } from '../data/people.js'

/** Fotoğrafın gerçek boyutu — tarayıcı yeri baştan ayırsın, sayfa zıplamasın. */
const PHOTO_SIZE = 640

/**
 * Ekip kartı — şablonun proje kartıyla birebir aynı kurgu: üstte yuvarlak
 * görsel alanı, altında ad ve rol, sağda kare düğmeler.
 *
 * Sayfası olan üyenin görseli ve adı profile götürür; olmayanınki götürmez.
 * Yarım dolu bir profil sayfası açmaktansa hiç açmamak daha iyi.
 */
function MemberCard({ member }) {
  const person = PEOPLE.find((entry) => entry.slug === member.photo)
  const profileHref = person?.hasPage ? `/ekip/${person.slug}` : null

  const photo = (
    <div className="mb-4 overflow-hidden rounded-2xl shadow-lg transition-shadow duration-300 hover:shadow-xl">
      <picture>
        <source srcSet={`/ekip/${member.photo}.webp`} type="image/webp" />
        <img
          src={`/ekip/${member.photo}.jpg`}
          alt={`${member.name} portresi`}
          width={PHOTO_SIZE}
          height={PHOTO_SIZE}
          loading="lazy"
          decoding="async"
          className="h-72 w-full object-cover object-[center_35%] transition-transform duration-300 group-hover:scale-105 md:h-96"
        />
      </picture>
    </div>
  )

  return (
    <article className="group">
      {profileHref ? (
        <Link to={profileHref} tabIndex={-1} aria-hidden="true" className="block">
          {photo}
        </Link>
      ) : (
        photo
      )}

      <div className="flex items-center gap-4 px-3">
        <div className="min-w-0 flex-grow">
          <h3 className="text-2xl font-semibold">
            {profileHref ? (
              <Link to={profileHref} className="transition-colors duration-300 hover:text-white">
                {member.name}
              </Link>
            ) : (
              member.name
            )}
          </h3>
          <span className="py-1 text-sm text-ink-muted">{member.role}</span>
        </div>

        <div className="ml-auto flex shrink-0 gap-2">
          <a
            href={`mailto:${COMPANY.email}`}
            aria-label={`${member.name} ile iletişime geç`}
            className="tpl-icon-btn size-14"
          >
            <Icon name="mail" className="size-7" />
          </a>
          {profileHref ? (
            <Link
              to={profileHref}
              aria-label={`${member.name} profil sayfası`}
              className="tpl-icon-btn size-14"
            >
              <Icon name="arrowUpRight" className="size-7" />
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export default function Team() {
  return (
    <section id="ekip" className="section-shell">
      <div className="section-inner">
        <p className="section-label shiny-sec">{TEAM.eyebrow}</p>
        <h2 className="section-heading mb-4">{TEAM.title}</h2>
        <p className="mb-8 max-w-2xl text-ink-muted">{TEAM.description}</p>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {TEAM.members.map((member) => (
            <MemberCard key={member.name} member={member} />
          ))}
        </div>
      </div>
    </section>
  )
}
