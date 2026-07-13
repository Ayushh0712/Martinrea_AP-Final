export const Role = {
  AP_Clerk: 'AP_Clerk',
  Plant_Manager: 'Plant_Manager',
  Finance_Director: 'Finance_Director',
  VP_Finance: 'VP_Finance',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  plantId: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}
