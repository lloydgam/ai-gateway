import cors from 'cors';
export default cors({
	origin: '*',
	methods: '*',
	allowedHeaders: '*',
	credentials: true
});
