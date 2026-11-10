"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { CheckIcon, CopyIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { generateQrCodeDataUrl, generateQrCodeSvg } from "@/lib/vitrine/qrcode";

const VERCEL_DOMAIN = "https://salonia-tn.vercel.app";

export function ShareModal({
  open,
  onClose,
  title,
  url,
  salonSlug,
  centerId,
  salonName,
  centerName,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  url: string;
  salonSlug?: string;
  centerId?: string | null;
  salonName: string;
  centerName?: string | null;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  // URL déployée sur Vercel accessible directement depuis n'importe quel smartphone
  const slug = salonSlug || (url.match(/\/salon\/([^\/?#]+)/)?.[1] ?? "");
  const centerPath = centerId ? `/${centerId}` : "";
  const targetUrl = slug
    ? `${VERCEL_DOMAIN}/salon/${slug}${centerPath}`
    : url && url.startsWith("http") && !url.includes("localhost")
    ? url
    : `${VERCEL_DOMAIN}`;

  const qrSvg = generateQrCodeSvg(targetUrl, { size: 260, color: "#2a0f25", bgColor: "#ffffff" });
  const qrDataUrl = generateQrCodeDataUrl(targetUrl, { size: 300, color: "#2a0f25", bgColor: "#ffffff" });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      const input = document.createElement("input");
      input.value = targetUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const shareText = encodeURIComponent(
    `Découvrez ${salonName}${centerName ? ` (${centerName})` : ""} et prenez rendez-vous en ligne : ${targetUrl}`,
  );
  const whatsappUrl = `https://api.whatsapp.com/send?text=${shareText}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || t("Partager la vitrine")}
    >
      <div className="space-y-6 text-center">
        {/* Conteneur du QR Code scannable */}
        <div className="relative mx-auto flex w-fit flex-col items-center justify-center rounded-3xl border-2 border-rose-gold/40 bg-white p-5 shadow-2xl">
          <div
            dangerouslySetInnerHTML={{ __html: qrSvg }}
            className="h-56 w-56 flex items-center justify-center [&>svg]:h-full [&>svg]:w-full"
          />
          <div className="mt-2 text-center">
            <p className="text-xs font-bold text-plum-950">{salonName}</p>
            {centerName && <p className="text-[10px] text-plum-900/70">{centerName}</p>}
          </div>
        </div>

        <p className="text-xs text-white/70">
          {t("Scannez ce QR Code avec l'appareil photo de votre smartphone pour accéder directement à la vitrine.")}
        </p>

        {/* Boutons d'action et de partage */}
        <div className="space-y-3">
          {/* Champ d'URL avec copie en 1 clic */}
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
            <input
              type="text"
              readOnly
              value={targetUrl}
              className="flex-1 bg-transparent px-3 text-xs text-white/90 outline-none selection:bg-rose-gold/40 font-mono"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-gold hover:text-plum-950"
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
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
            >
              {t("Télécharger le QR")}
            </a>

            {/* Partage WhatsApp */}
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366]/20 border border-[#25D366]/40 py-2.5 text-xs font-semibold text-[#25D366] transition hover:bg-[#25D366] hover:text-plum-950"
            >
              {t("WhatsApp")}
            </a>
          </div>
        </div>
      </div>
    </Modal>
  );
}
