import BaseHTTPServer, SimpleHTTPServer
import ssl

httpd = BaseHTTPServer.HTTPServer(('0.0.0.0', 443), SimpleHTTPServer.SimpleHTTPRequestHandler)
httpd.socket = ssl.wrap_socket (httpd.socket, certfile='../../docker/files/certificates/pionsh.pem', server_side=True, keyfile='../../docker/files/certificates/pionsh.key')
httpd.serve_forever()
