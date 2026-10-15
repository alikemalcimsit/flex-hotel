import { useNavigate } from 'react-router-dom';
import { Button } from '@hotelos/ui';
import { useAgencyBonusLive } from '../../lib/agencyBonus.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { BonusRulesTab } from '../agency-bonus/BonusRulesTab.jsx';
import { BonusSettlementsTab } from '../agency-bonus/BonusSettlementsTab.jsx';
import { useAgencyContext } from './AgencyPage.jsx';

/**
 * Acente kartının "Prim ve hedef" sekmesi (modül 35): bu acentenin prim
 * kuralları (hedef durumu) ve dönem sonu hak edişleri. Sekme
 * `agency_bonus.view` iznine bağlıdır (kabuk izinsiz kullanıcıya göstermez).
 */
export function AgencyBonusTab() {
  const { agency } = useAgencyContext();
  const can = useCan();
  const navigate = useNavigate();
  useAgencyBonusLive();

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="agency-bonus-rules" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="agency-bonus-rules" className="text-lg font-bold text-ink">
              Hedef ve prim kuralları
            </h2>
            <p className="text-sm text-ink-muted">Dönem hedefi, kademeli prim oranları ve şu ana kadarki ilerleme.</p>
          </div>
          {can(PERMISSIONS.AGENCY_BONUS_MANAGE) && (
            <Button type="button" icon="plus" onClick={() => navigate(`/acente-primleri/yeni?acente=${agency.id}`)}>
              Yeni prim kuralı
            </Button>
          )}
        </div>
        <BonusRulesTab agencyId={agency.id} embedded />
      </section>
      <section aria-labelledby="agency-bonus-settlements" className="flex flex-col gap-3">
        <div>
          <h2 id="agency-bonus-settlements" className="text-lg font-bold text-ink">
            Hak edişler
          </h2>
          <p className="text-sm text-ink-muted">Dönem sonu hesaplanan primler: onay ve ödeme durumu.</p>
        </div>
        <BonusSettlementsTab agencyId={agency.id} embedded />
      </section>
    </div>
  );
}
