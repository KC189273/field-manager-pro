import { useState, useEffect } from 'react'

interface UseOrgModulesResult {
  modules: string[]
  hasModule: (slug: string) => boolean
  isLoading: boolean
}

/**
 * Hook to check which modules are enabled for an organization.
 * Future use: conditionally render features based on org entitlements.
 */
export function useOrgModules(orgId: string | null | undefined): UseOrgModulesResult {
  const [modules, setModules] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!orgId) {
      setModules([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    fetch(`/api/super-admin/orgs/${orgId}/modules`)
      .then(r => {
        if (!r.ok) return { modules: [] }
        return r.json()
      })
      .then(d => {
        const enabled = (d.modules ?? [])
          .filter((m: { enabled: boolean }) => m.enabled)
          .map((m: { slug: string }) => m.slug)
        setModules(enabled)
      })
      .catch(() => setModules([]))
      .finally(() => setIsLoading(false))
  }, [orgId])

  return {
    modules,
    hasModule: (slug: string) => modules.includes(slug),
    isLoading,
  }
}
