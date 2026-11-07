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
import { AlertIcon, CheckIcon, CopyIcon, LockIcon, PlusIcon, ShieldIcon, SparkleIcon, TagIcon, WalletIcon } from "@/components/ui/icons";
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
// Interface guidée : soldes expliqués avec leur action, premiers pas cochés automatiquement,
// chargement visible sur le bouton utilisé et confirmation avant de retirer le wallet.
const LOW_GAS_ETH = 0.002; // en dessous, une transaction (acompte, annulation) risque d'échouer faute de frais

type WalletAction = "mocktnd" | "withdraw" | "gas" | "watch" | "unlink" | "link";

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" aria-hidden />;
}

export function WalletCard({ cfg, initial }: { cfg: EscrowWebConfig | null; initial: MyWalletInfo }) {
  const { t } = useI18n();
  const router = useRouter();
  const [info, setInfo] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<WalletAction | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, start] = useTransition();
  if (!cfg) return null;

  const refresh = async () => setInfo(await getMyWalletInfo());
  const run = (action: WalletAction, task: () => Promise<unknown>, success: string) =>
    start(async () => {
      setMessage(null);
      setBusy(action);
      try {
        await task();
        setMessage({ tone: "ok", text: success });
        await refresh();
        router.refresh();
      } catch (e) {
        setMessage({ tone: "error", text: metaMaskMessage(e) });
      } finally {
        setBusy(null);
        setConfirmUnlink(false);
      }
    });

  const network = cfg.network === "sepolia" ? "Réseau de test Sepolia" : "Réseau local Hardhat";
  const b = info.balances;
  const eth = b ? Number(b.eth) : 0;
  const mock = b ? Number(b.mockTnd) : 0;
  const claimable = b ? Number(b.claimable) : 0;
  const lowGas = b !== null && eth < LOW_GAS_ETH;
  const steps = [
    { label: "Relier MetaMask à mon compte", done: Boolean(info.address) },
    { label: "Recevoir de l'ETH de test pour les frais", done: eth >= LOW_GAS_ETH },
    { label: "Recevoir des MockTND pour l'acompte", done: mock > 0 },
    { label: "Réserver un rendez-vous avec acompte sécurisé", done: false },
  ];
  const showSteps = !steps[1].done || !steps[2].done;

  return (
    <section className="glass mt-10 overflow-hidden rounded-[2rem] animate-fade-up">
      {/* En-tête : identité du wallet */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-[#f6851b]/15 via-transparent to-transparent p-6 rtl:bg-gradient-to-l">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#f6851b] to-[#e2761b] text-white shadow-lg shadow-[#f6851b]/20">
            <WalletIcon width={22} height={22} />
          </span>
          <div>
            <h2 className="font-display text-2xl text-white">{t("Mon wallet MetaMask")}</h2>
            <p className="text-xs text-white/50">
              {t("Acompte sécurisé par la blockchain")} · {t(network)}
            </p>
          </div>
        </div>
        {info.address && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />
              {t("Connecté")}
              <span className="font-mono text-white/80" dir="ltr">
                {short(info.address)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(info.address!).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
              aria-label={t("Copier l'adresse")}
              title={t("Copier l'adresse")}
              className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-white/60 transition hover:border-white/25 hover:text-white"
            >
              {copied ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
            </button>
          </div>
        )}
      </div>

      <div className="p-6">
        {!info.address ? (
          // Pas encore relié : les avantages, puis l'action.
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: <LockIcon width={18} height={18} />, title: "Acompte sécurisé", text: "Votre acompte est bloqué dans un contrat, pas chez le salon." },
                { icon: <SparkleIcon width={18} height={18} />, title: "Sans mot de passe", text: "Connectez-vous en une signature MetaMask." },
                { icon: <ShieldIcon width={18} height={18} />, title: "Clé privée protégée", text: "Salonia ne voit jamais votre clé : seule la signature est envoyée." },
              ].map((x) => (
                <div key={x.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f6851b]/15 text-[#ffcf9e]">{x.icon}</span>
                  <p className="mt-3 text-sm font-medium text-white">{t(x.title)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/55">{t(x.text)}</p>
                </div>
              ))}
            </div>
            <LinkWalletButton cfg={cfg} onLinked={() => run("link", refresh, "Wallet relié à votre compte.")} />
          </div>
        ) : (
          <>
            {/* Soldes, chacun avec son action */}
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-champagne/30 bg-gradient-to-br from-champagne/10 to-transparent p-4">
                <p className="text-xs uppercase tracking-wider text-champagne/80">{t("Mes jetons MockTND")}</p>
                <p className="mt-1 font-display text-3xl text-white">
                  <bdi>{b ? b.mockTnd : "—"}</bdi> <span className="text-base text-white/50">TND</span>
                </p>
                <p className="mt-1 text-xs text-white/50">{t("Monnaie de test pour payer l'acompte")}</p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run("mocktnd", () => faucetWithMetaMask(cfg, info.address!, 100), "100 MockTND de test reçus.")}
                  className="btn-shine mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-plum-950 disabled:opacity-60"
                >
                  {busy === "mocktnd" ? <Spinner /> : <PlusIcon width={16} height={16} />} {t("Recevoir 100 MockTND")}
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs uppercase tracking-wider text-white/50">{t("À récupérer")}</p>
                <p className="mt-1 font-display text-3xl text-white">
                  <bdi>{b ? b.claimable : "—"}</bdi> <span className="text-base text-white/50">TND</span>
                </p>
                <p className="mt-1 text-xs text-white/50">{t("Acomptes remboursés, en attente dans le contrat")}</p>
                <button
                  type="button"
                  disabled={busy !== null || claimable <= 0}
                  onClick={() => run("withdraw", () => withdrawWithMetaMask(cfg, info.address!), "Solde retiré vers votre wallet.")}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-2.5 text-sm text-white/85 transition hover:border-rose-gold/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "withdraw" && <Spinner />} {claimable > 0 ? t("Retirer vers mon wallet") : t("Rien à retirer")}
                </button>
              </div>

              <div className={`rounded-2xl border p-4 ${lowGas ? "border-amber-300/40 bg-amber-300/[0.06]" : "border-white/10 bg-white/[0.04]"}`}>
                <p className="text-xs uppercase tracking-wider text-white/50">{t("ETH de test")}</p>
                <p className="mt-1 font-display text-3xl text-white">
                  <bdi>{b ? eth.toFixed(4) : "—"}</bdi> <span className="text-base text-white/50">ETH</span>
                </p>
                <p className={`mt-1 text-xs ${lowGas ? "text-amber-200" : "text-white/50"}`}>
                  {lowGas ? t("Solde trop faible pour payer les frais du réseau") : t("Sert à payer les frais du réseau")}
                </p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      "gas",
                      async () => {
                        const r = await requestTestGas();
                        if (!r.ok) throw new MetaMaskError(r.error);
                      },
                      "ETH de test envoyé pour le gaz.",
                    )
                  }
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-2.5 text-sm text-white/85 transition hover:border-rose-gold/50 disabled:opacity-50"
                >
                  {busy === "gas" ? <Spinner /> : <PlusIcon width={16} height={16} />} {t("Recevoir de l'ETH de test")}
                </button>
              </div>
            </div>

            {/* Premiers pas : cochés automatiquement selon les soldes */}
            {showSteps && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">{t("Premiers pas")}</p>
                <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                  {steps.map((step, i) => (
                    <li key={step.label} className="flex items-center gap-3 text-sm">
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${step.done ? "bg-emerald-400/20 text-emerald-300" : "border border-white/20 text-white/50"}`}
                      >
                        {step.done ? <CheckIcon width={13} height={13} /> : i + 1}
                      </span>
                      <span className={step.done ? "text-white/45 line-through" : "text-white/80"}>{t(step.label)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Actions secondaires */}
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("watch", () => watchMockTnd(cfg), "MockTND ajouté à MetaMask.")}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {busy === "watch" ? <Spinner /> : <TagIcon width={15} height={15} />} {t("Afficher MockTND dans MetaMask")}
              </button>
              {!confirmUnlink ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirmUnlink(true)}
                  className="ms-auto rounded-xl px-3 py-2 text-sm text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
                >
                  {t("Retirer ce wallet")}
                </button>
              ) : (
                <div className="ms-auto flex flex-wrap items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-sm" role="alertdialog" aria-label={t("Retirer ce wallet")}>
                  <span className="text-red-100">{t("Retirer ce wallet de votre compte ?")}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        "unlink",
                        async () => {
                          const r = await unlinkMyWallet();
                          if (!r.ok) throw new MetaMaskError(r.error);
                        },
                        "Wallet retiré de votre compte.",
                      )
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-red-500/80 px-2.5 py-1 font-semibold text-white disabled:opacity-60"
                  >
                    {busy === "unlink" && <Spinner />} {t("Oui, retirer")}
                  </button>
                  <button type="button" onClick={() => setConfirmUnlink(false)} className="rounded-lg px-2 py-1 text-white/70 hover:text-white">
                    {t("Annuler")}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {busy !== null && busy !== "watch" && (
          <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-[#f6851b]/30 bg-[#f6851b]/10 px-3 py-2 text-xs text-[#ffcf9e]">
            <Spinner /> {t("Validez dans MetaMask…")}
          </p>
        )}
        {message && (
          <p
            role="status"
            className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${message.tone === "ok" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}`}
          >
            {message.tone === "ok" ? <CheckIcon width={16} height={16} /> : <AlertIcon width={16} height={16} />} {t(message.text)}
          </p>
        )}
      </div>
    </section>
  );
}
