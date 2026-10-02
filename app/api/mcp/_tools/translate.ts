import { makeTranslateTools } from '@/lib/integration/tools/translate'

import { invokeLocalApi } from './route-invoke'

export const translateTools = makeTranslateTools(invokeLocalApi)
