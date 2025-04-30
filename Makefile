start-redis:
	# CLI: redis-cli -p 6397
	redis-stable/src/redis-server redis-stable/redis.conf

start-server:
	npx nodemon --exitcrash --ignore public server.js

start-daemons:
	# DATABASE
	# CHECK: ps aux | grep redis-server | grep cmarnold
	# SHUTDOWN: redis-7.0.8/src/redis-cli -p 6397 shutdown
	redis-stable/src/redis-server redis-stable/redis.conf --daemonize yes
	# SERVER
	# CHECK: ps aux | grep node | grep cmarnold
	# KILL: kill -9 PID
	npx nodemon --exitcrash --ignore public server.js


