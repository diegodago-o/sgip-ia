import { useAuth } from '../context/AuthContext';

// Normalize old DB role names to current system roles
const ROLE_MAP = {
  admin: 'admin',
  director: 'gerente_proyecto',
  gerente_proyecto: 'gerente_proyecto',
  consultor: 'apoyo',
  apoyo: 'apoyo',
  visor: 'director_pmo',
  director_pmo: 'director_pmo',
  ceo: 'ceo',
};

export function usePermissions(module) {
  const { user } = useAuth();
  const rawRole = user?.role || 'ceo';
  const role = ROLE_MAP[rawRole] || 'apoyo';

  const isAdmin = role === 'admin';
  const isGP = role === 'gerente_proyecto';
  const isApoyo = role === 'apoyo';
  const isPMO = role === 'director_pmo';
  const isCEO = role === 'ceo';

  const canCreate = isAdmin || isGP || isApoyo;
  const canEdit = isAdmin || isGP || isApoyo;
  const canDelete = isAdmin || isGP;
  const canApprove = isAdmin || isGP;
  const canAddEvidence = isAdmin || isGP || isApoyo;
  const canChangeStatus = isAdmin || isGP;

  if (module === 'adjudicacion') {
    return {
      role, canCreate: isAdmin || isGP, canEdit: isAdmin || isGP,
      canDelete: isAdmin, canDeleteOwn: isAdmin || isGP,
      canApprove, canAddEvidence, canChangeStatus,
      isAdmin, isGP, isApoyo, isPMO, isCEO,
    };
  }

  if (module === 'ejecucion') {
    return {
      role, canCreate: isAdmin || isGP || isApoyo, canEdit: isAdmin || isGP || isApoyo,
      canDelete: isAdmin, canDeleteOwn: isAdmin || isGP,
      canApprove, canAddEvidence, canChangeStatus,
      isAdmin, isGP, isApoyo, isPMO, isCEO,
    };
  }

  if (module === 'cierre') {
    return {
      role, canCreate: isAdmin || isGP, canEdit: isAdmin || isGP || isApoyo,
      canDelete: isAdmin, canDeleteOwn: isAdmin || isGP,
      canApprove, canAddEvidence, canChangeStatus: isAdmin || isGP,
      isAdmin, isGP, isApoyo, isPMO, isCEO,
    };
  }

  return {
    role, canCreate, canEdit, canDelete, canDeleteOwn: isAdmin || isGP,
    canApprove, canAddEvidence, canChangeStatus,
    isAdmin, isGP, isApoyo, isPMO, isCEO,
  };
}
