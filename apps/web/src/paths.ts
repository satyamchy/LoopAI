import { useParams } from "react-router-dom";

export function workspaceSlug(username: string): string {
  return `${username}_workspace`;
}

export function useBase(): string {
  const { workspace } = useParams();
  return `/${workspace}/~`;
}

export function workspaceHome(username: string): string {
  return `/${workspaceSlug(username)}/~`;
}
