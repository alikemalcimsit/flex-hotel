import Home from '../components/Home.jsx'
import Solutions from '../components/Solutions.jsx'
import About from '../components/About.jsx'
import Process from '../components/Process.jsx'
import Team from '../components/Team.jsx'
import Contact from '../components/Contact.jsx'

/**
 * Anasayfa — şablonun sırası: açılış, projeler, iletişim. Şablonda olmayan
 * Hakkımızda, Süreç ve Ekip, projeler ile iletişim arasına aynı dille girdi.
 */
export default function HomePage() {
  return (
    <>
      <Home />
      <Solutions />
      <About />
      <Process />
      <Team />
      <Contact />
    </>
  )
}
