"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { DeviceIcon } from "@/components/ui/icons";
import type { AuthEventType } from "@/lib/enums";

export type SecurityEvent = {
  id: string;
  type: AuthEventType;
  ip: string | null;
  device: string;
  createdAt: string;
  who: string | null;
};

const EVENTS: Record<AuthEventType, { label: string; tone: string }> = {
  LOGIN_SUCCESS: { label: "Connexion réussie", tone: "bg-emerald-400" },
  LOGIN_FAILED: { label: "Mot de passe incorrect", tone: "bg-amber-400" },
  LOGIN_LOCKED: { label: "Compte bloqué 5 min", tone: "bg-red-400" },
  LOGOUT: { label: "Déconnexion", tone: "bg-white/40" },
  REGISTER: { label: "Création du compte", tone: "bg-champagne" },
  PASSWORD_RESET_REQUEST: { label: "Demande de réinitialisation", tone: "bg-sky-400" },
  PASSWORD_RESET: { label: "Mot de passe modifié", tone: "bg-sky-400" },
  CENTER_CREATED: { label: "Centre ajouté", tone: "bg-rose-gold" },
  AI_SETUP_APPLIED: { label: "Configuration IA appliquée", tone: "bg-[#c9a0dc]" },
  BOOKING_CREATED: { label: "Rendez-vous créé", tone: "bg-emerald-400" },
  BOOKING_CANCELLED: { label: "Rendez-vous annulé", tone: "bg-red-400" },
  BOOKING_RESCHEDULED: { label: "Rendez-vous reporté", tone: "bg-amber-400" },
  REMINDERS_SENT: { label: "Rappels envoyés", tone: "bg-sky-400" },
  PAYMENT_RECORDED: { label: "Paiement encaissé", tone: "bg-emerald-400" },
  PAYMENT_REFUNDED: { label: "Paiement remboursé", tone: "bg-amber-400" },
  INVOICE_ISSUED: { label: "Facture émise", tone: "bg-champagne" },
  INVOICE_CANCELLED: { label: "Facture annulée", tone: "bg-red-400" },
  EXPENSE_CREATED: { label: "Dépense ajoutée", tone: "bg-[#c9a0dc]" },
  EXPENSE_DELETED: { label: "Dépense supprimée", tone: "bg-red-400" },
  FINANCE_EXPORTED: { label: "Export financier", tone: "bg-sky-400" },
  PAYMENT_LINK_CANCELLED: { label: "Lien de paiement annulé", tone: "bg-amber-400" },
  CASH_CLOSED: { label: "Caisse clôturée", tone: "bg-emerald-400" },
  CASH_REOPENED: { label: "Caisse rouverte", tone: "bg-amber-400" },
  FINANCE_SETTINGS_UPDATED: { label: "Paramètres financiers modifiés", tone: "bg-sky-400" },
};

// Fuseau et langue explicites : même rendu côté serveur et navigateur.
function formatDate(iso: string, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-TN" : "fr-TN", {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: "Africa/Tunis",
  }).format(new Date(iso));
}

export function SecurityLog({ events }: { events: SecurityEvent[] }) {
  const { t, lang } = useI18n();

  if (events.length === 0) {
    return <p className="text-sm text-white/50">{t("Aucune activité pour le moment.")}</p>;
  }

  return (
    <ol className="relative space-y-1">
      <span aria-hidden className="absolute bottom-3 start-[7px] top-3 w-px bg-gradient-to-b from-white/20 to-transparent" />
      {events.map((e, i) => {
        const meta = EVENTS[e.type];
        return (
          <li
            key={e.id}
            className="relative flex items-start gap-4 rounded-2xl px-0 py-2.5 animate-fade-up"
            style={{ animationDelay: `${0.05 * i}s` }}
          >
            <span className={`relative mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-plum-950 ${meta.tone}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white">
                {t(meta.label)}
                {e.who && <span className="text-white/50"> · {e.who}</span>}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/45">
                <DeviceIcon width={12} height={12} /> {t(e.device)}
                {e.ip && <span dir="ltr">· {e.ip}</span>}
              </p>
            </div>
            <time dateTime={e.createdAt} className="shrink-0 text-xs text-white/40">
              {formatDate(e.createdAt, lang)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
