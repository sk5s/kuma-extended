import { Hono } from 'hono'
import status from './status.js'

const v1 = new Hono()

v1.route('/', status)

export default v1
