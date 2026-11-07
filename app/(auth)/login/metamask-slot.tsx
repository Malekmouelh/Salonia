import { connection } from "next/server";
import { getEscrowWebConfig } from "@/app/actions/wallet";
import { MetaMaskLoginButton } from "@/components/wallet/metamask";

// Bouton « Se connecter avec MetaMask » : la configuration (réseau, contrat) est lue à la requête,
// jamais figée au build (les variables ESCROW_* peuvent changer d'un déploiement à l'autre).
export async function MetaMaskSlot() {
  await connection();
  return <MetaMaskLoginButton cfg={await getEscrowWebConfig()} />;
}
