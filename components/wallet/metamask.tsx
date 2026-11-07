"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import {
  getLinkNonce,
  getLoginNonce,
  getMyWalletInfo,
  linkMyWallet,
  loginWithWallet,
  requestTestGas,
  unlinkMyWallet,
  type EscrowWebConfig,
  type MyWalletInfo,
} from "@/app/actions/wallet";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Alert } from "@/components/ui/form";
import { WalletIcon } from "@/components/ui/icons";
import { MetaMaskError, faucetWithMetaMask, hasMetaMask, metaMaskMessage, signInMessage, watchMockTnd, withdrawWithMetaMask } from "@/lib/wallet/browser";

// SalonEscrow + MetaMask : connexion (Sign-In With Ethereum), liaison du wallet au compte Salonia et gestion
// de la monnaie de test. Seule la signature quitte le navigateur, jamais la clé privée.

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

// MetaMask installé ? Le serveur ne peut pas le savoir : il suppose « oui » (aucun message), puis le navigateur
// corrige après l'hydratation, sans décalage entre le HTML du serveur et celui du client.
const noSubscribe = () => () => {};
export function useMetaMaskInstalled() {
  return useSyncExternalStore(noSubscribe, hasMetaMask, () => true);
}

function NoMetaMask() {
  const { t } = useI18n();
  return (
    <p className="text-xs text-white/50">
      {t("MetaMask n'est pas installé dans ce navigateur.")}{" "}
      <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="text-champagne underline-offset-4 hover:underline">
        {t("Installer MetaMask")}
      </a>
    </p>
  );
}

// ── Page de connexion : « Se connecter avec MetaMask » ──
export function MetaMaskLoginButton({ cfg }: { cfg: EscrowWebConfig | null }) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const installed = useMetaMaskInstalled();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!cfg) return null;

  const login = () =>
    start(async () => {
      setError(null);
      try {
        const { nonce, error: nonceError } = await getLoginNonce();
        if (!nonce) return setError(nonceError ?? "Erreur");
        const signed = await signInMessage(cfg, nonce, "Connexion à Salonia avec MetaMask.");
        // En cas de succès, le serveur redirige (cookie de session NextAuth posé).
        const r = await loginWithWallet({ message: signed.message, signature: signed.signature, next: searchParams.get("next") });
        if (r && !r.ok) setError(r.error);
      } catch (e) {
        setError(metaMaskMessage(e));
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-white/30">
        <span className="h-px flex-1 bg-white/10" /> {t("ou")} <span className="h-px flex-1 bg-white/10" />
      </div>
      {error && <Alert>{t(error)}</Alert>}
      <button
        type="button"
        onClick={login}
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#f6851b]/40 bg-[#f6851b]/10 text-sm font-medium text-[#ffcf9e] transition hover:bg-[#f6851b]/20 disabled:opacity-60"
      >
        <WalletIcon width={18} height={18} />
        {pending ? t("Signature dans MetaMask…") : t("Se connecter avec MetaMask")}
      </button>
      {!installed && <NoMetaMask />}
    </div>
  );
}

// ── Liaison du wallet au compte connecté (MetaMask signe un message, aucune transaction) ──
export function useLinkWallet(cfg: EscrowWebConfig | null) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const link = useCallback(
    (onLinked: (address: string) => void) =>
      start(async () => {
        setError(null);
        if (!cfg) return setError("La connexion MetaMask n'est pas activée sur ce serveur.");
        try {
          const { nonce, error: nonceError } = await getLinkNonce();
          if (!nonce) return setError(nonceError ?? "Erreur");
          const signed = await signInMessage(cfg, nonce, "Relier ce wallet MetaMask à mon compte Salonia.");
          const r = await linkMyWallet({ message: signed.message, signature: signed.signature });
          if (r.ok) onLinked(r.address!);
          else setError(r.error);
        } catch (e) {
          setError(metaMaskMessage(e));
        }
      }),
    [cfg],
  );
  return { link, error, pending };
}

export function LinkWalletButton({ cfg, onLinked }: { cfg: EscrowWebConfig | null; onLinked: (address: string) => void }) {
  const { t } = useI18n();
  const { link, error, pending } = useLinkWallet(cfg);
  const installed = useMetaMaskInstalled();
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => link(onLinked)}
        className="flex items-center justify-center gap-2 rounded-xl border border-[#f6851b]/40 bg-[#f6851b]/10 px-4 py-2.5 text-sm font-medium text-[#ffcf9e] transition hover:bg-[#f6851b]/20 disabled:opacity-60"
      >
        <WalletIcon width={16} height={16} />
        {pending ? t("Signature dans MetaMask…") : t("Relier MetaMask")}
      </button>
      {error && installed && <p className="text-xs text-red-300">{t(error)}</p>}
      {!installed && <NoMetaMask />}
    </div>
  );
}

// ── Espace client : mon wallet MetaMask et ma monnaie de test ──
export function WalletCard({ cfg, initial }: { cfg: EscrowWebConfig | null; initial: MyWalletInfo }) {
  const { t } = useI18n();
  const router = useRouter();
  const [info, setInfo] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!cfg) return null;

  const refresh = async () => setInfo(await getMyWalletInfo());
  const run = (task: () => Promise<unknown>, success: string) =>
    start(async () => {
      setMessage(null);
      try {
        await task();
        setMessage({ tone: "ok", text: success });
        await refresh();
        router.refresh();
      } catch (e) {
        setMessage({ tone: "error", text: metaMaskMessage(e) });
      }
    });

  return (
    <section className="glass mt-10 rounded-[2rem] p-6 animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-2xl text-white">
          <WalletIcon width={22} height={22} /> {t("Mon wallet MetaMask")}
        </h2>
        {info.address && (
          <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-white/70" dir="ltr">
            {short(info.address)}
          </span>
        )}
      </div>

      {!info.address ? (
        <div className="mt-4 space-y-3 text-sm text-white/65">
          <p>{t("Reliez MetaMask pour réserver avec l'acompte sécurisé et vous connecter sans mot de passe. Salonia ne voit jamais votre clé privée.")}</p>
          <LinkWalletButton cfg={cfg} onLinked={() => run(refresh, "Wallet relié à votre compte.")} />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: "MockTND (jeton de test)", value: info.balances ? `${info.balances.mockTnd} TND` : "—" },
              { label: "À retirer du contrat", value: info.balances ? `${info.balances.claimable} TND` : "—" },
              { label: "ETH de test (gaz)", value: info.balances ? Number(info.balances.eth).toFixed(4) : "—" },
            ].map((b) => (
              <div key={b.label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs text-white/50">{t(b.label)}</p>
                <p className="mt-1 font-display text-xl text-white">
                  <bdi>{b.value}</bdi>
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => run(() => faucetWithMetaMask(cfg, info.address!, 100), "100 MockTND de test reçus.")} className="btn-shine rounded-xl px-4 py-2 text-sm font-semibold text-plum-950 disabled:opacity-60">
              {t("Recevoir 100 MockTND de test")}
            </button>
            <button
              type="button"
              disabled={pending || !info.balances || info.balances.claimable === "0"}
              onClick={() => run(() => withdrawWithMetaMask(cfg, info.address!), "Solde retiré vers votre wallet.")}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/85 transition hover:border-rose-gold/50 disabled:opacity-50"
            >
              {t("Retirer mon solde")}
            </button>
            <button type="button" disabled={pending} onClick={() => run(async () => { const r = await requestTestGas(); if (!r.ok) throw new MetaMaskError(r.error); }, "ETH de test envoyé pour le gaz.")} className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/85 transition hover:border-rose-gold/50 disabled:opacity-50">
              {t("Recevoir de l'ETH de test")}
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => watchMockTnd(cfg), "MockTND ajouté à MetaMask.")} className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/85 transition hover:border-rose-gold/50 disabled:opacity-50">
              {t("Afficher MockTND dans MetaMask")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await unlinkMyWallet();
                  if (!r.ok) throw new MetaMaskError(r.error);
                }, "Wallet retiré de votre compte.")
              }
              className="ms-auto rounded-xl border border-red-400/30 px-4 py-2 text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              {t("Retirer ce wallet")}
            </button>
          </div>
          {pending && <p role="status" className="mt-3 text-xs text-white/50">{t("Validez dans MetaMask…")}</p>}
        </>
      )}
      {message && (
        <p role="status" className={`mt-3 text-sm ${message.tone === "ok" ? "text-emerald-300" : "text-red-300"}`}>
          {t(message.text)}
        </p>
      )}
    </section>
  );
}
