import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ATHLETES_TEST_RESULTS_SERVICE, createAthletesTestResultsService } from './lib/testResultsService'

export { ATHLETES_TEST_RESULTS_SERVICE }

export function register(container: AppContainer) {
  // `.scoped()`: the service closes over the request container's `em`; a singleton would pin
  // one request's EntityManager — and with it one request's club — for the life of the process.
  container.register({
    [ATHLETES_TEST_RESULTS_SERVICE]: asFunction(createAthletesTestResultsService).scoped(),
  })
}
