"use client";

import { useId, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { CheckIcon, CopyIcon, SparkleIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { generateQrCodeDataUrl, generateQrCodeSvg } from "@/lib/vitrine/qrcode";

export function ShareModal({
  open,
  onClose,
  title,
  url,
  salonName,
  centerName,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  url: string;
  salonName: string;
  centerName?: string | null;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const qrSvg = generateQrCodeSvg(url, { size: 260, color: "#2a0f25", bgColor: "#ffffff" });
  const qrDataUrl = generateQrCodeDataUrl(url, { size: 300, color: "#2a0f25", bgColor: "#ffffff" });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback
    }
  };

  const shareText = encodeURIComponent(
    `Découvrez ${salonName}${centerName ? ` (${centerName})` : ""} et prenez rendez-vous en ligne : ${url}`,
  );
  const whatsappUrl = `https://api.whatsapp.com/send?text=${shareText}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || t("Partager la page")}
    >
      <div className="space-y-6 text-center">
        {/* QR Code Container */}
        <div className="relative mx-auto flex w-fit flex-col items-center justify-center rounded-3xl border-2 border-rose-gold/40 bg-white p-5 shadow-2xl">
          <div
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            className="h-56 w-56 [&>svg]:h-full [&>svg]:w-full"
          />
          <div className="mt-2 text-center">
            <p className="text-xs font-semibold text-plum-950">{salonName}</p>
            {centerName && <p className="text-[10px] text-plum-900/70">{centerName}</p>}
          </div>
        </div>

        <p className="text-xs text-white/60">
          {t("Scannez ce QR Code avec un smartphone pour accéder instantanément à la réservation.")}
        </p>

        {/* Boutons de partage */}
        <div className="space-y-3">
          {/* Copie de lien */}
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
            <input
              type="text"
              readOnly
              value={url}
              className="flex-1 bg-transparent px-3 text-xs text-white/90 outline-none selection:bg-rose-gold/40"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-rose-gold hover:text-plum-950"
            >
              {copied ? (
                <>
                  <CheckIcon width={14} height={14} className="text-emerald-400" />
                  <span>{t("Copié !")}</span>
                </>
              ) : (
                <>
                  <CopyIcon width={14} height={14} />
                  <span>{t("Copier")}</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Télécharger QR Code */}
            <a
              href={qrDataUrl}
              download={`qrcode-${salonName.toLowerCase().replace(/\s+/g, "-")}.svg`}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-medium text-white transition hover:border-white/20 hover:bg-white/10"
            >
              {t("Télécharger le QR")}
            </a>

            {/* Partage WhatsApp */}
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366]/20 border border-[#25D366]/40 py-2.5 text-xs font-medium text-[#25D366] transition hover:bg-[#25D366] hover:text-plum-950"
            >
              {t("WhatsApp")}
            </a>
          </div>
        </div>
      </div>
    </Modal>
  );
}
