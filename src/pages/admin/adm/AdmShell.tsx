import type { ReactNode } from "react";
import AppFrame from "@/components/hp/AppFrame";
import { ADM_NAV } from "./admNav";

/** Shell exclusivo do Administrativo — sidebar própria, só com a navegação administrativa. */
const AdmShell = ({ children }: { children: ReactNode }) => (
  <AppFrame appId="adm" nav={ADM_NAV} managerRoles={["manager", "ops_admin"]}>{children}</AppFrame>
);

export default AdmShell;
