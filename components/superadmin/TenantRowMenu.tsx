"use client";

import { useMemo } from "react";
import { MoreHorizontal, ExternalLink, Power, Trash2 } from "lucide-react";
import { RowActionsMenu, type RowActionItem } from "@/components/ui/RowActionsMenu";

export interface TenantMenuTarget {
  subdomain: string;
  school_name: string;
  suspended: boolean;
  deleted?: boolean;
}

interface Props {
  tenant: TenantMenuTarget;
  onSuspend: (tenant: TenantMenuTarget) => void;
  onDelete: (tenant: TenantMenuTarget) => void;
  onRestore?: (tenant: TenantMenuTarget) => void;
}

/**
 * Superadmin school actions.
 *
 * Thin domain wrapper over <RowActionsMenu>. The dropdown mechanics — outside
 * click, Escape, focus return, panel geometry — live in that shared component;
 * this file only decides WHICH actions a school row offers. A deleted school
 * has one action (restore); a live one has three.
 */
export function TenantRowMenu({ tenant, onSuspend, onDelete, onRestore }: Props) {
  const items = useMemo<RowActionItem[]>(() => {
    const visit: RowActionItem = {
      label: "Visit Portal",
      icon: ExternalLink,
      href: `https://${tenant.subdomain}.resultapp.org`,
      external: true,
    };

    if (tenant.deleted) {
      return [
        visit,
        {
          label: "Restore School",
          icon: Power,
          variant: "success",
          onSelect: () => onRestore?.(tenant),
        },
      ];
    }

    return [
      visit,
      {
        label: tenant.suspended ? "Activate" : "Suspend",
        icon: Power,
        onSelect: () => onSuspend(tenant),
      },
      {
        label: "Delete School",
        icon: Trash2,
        variant: "danger",
        separatorBefore: true,
        onSelect: () => onDelete(tenant),
      },
    ];
  }, [tenant, onSuspend, onDelete, onRestore]);

  return (
    <RowActionsMenu
      label={`Actions for ${tenant.subdomain}`}
      items={items}
      triggerIcon={MoreHorizontal}
    />
  );
}
