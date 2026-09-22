export const UPDATE_AVAILABLE_EVENT = "jinriji:update-available";

export interface UpdateAvailableDetail {
  message: string;
  action: () => void;
  label: string;
}
