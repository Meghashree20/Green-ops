export interface EstimationRequest {
  workload_id: string
  duration_seconds: number
  hourly_instance_rate_usd: number
  cpu_utilization_pct?: number | null
  server_tdp_watts?: number | null
  emissions_factor_kg_co2_per_kwh?: number | null
}

export interface EstimationAssumptions {
  hourly_instance_rate_usd: number
  duration_seconds: number
  duration_hours: number
  cpu_utilization_pct: number | null
  server_tdp_watts: number | null
  emissions_factor_kg_co2_per_kwh: number | null
}

export interface EstimationResult {
  workload_id: string
  estimated_compute_cost_usd: number
  estimated_workload_cost_usd: number | null
  estimated_energy_kwh: number | null
  estimated_carbon_kg_co2e: number | null
  assumptions: EstimationAssumptions
  warnings: string[]
}
