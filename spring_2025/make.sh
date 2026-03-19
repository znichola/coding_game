CFLAGS="-Wall -Wextra -Werror"
CFLAGS=""

rm -f ceph

g++ -std=c++17 $CFLAGS *.cpp -o ceph && \
echo 40 0 6 0 2 2 2 1 6 1 | ./ceph
echo "322444322 is correct"

echo ""
echo ""
echo "~~~ CAPUTRE TESTS ~~~"
echo ""

echo 1  6 1 6 1 0 1 6 1 6 | ./ceph 
echo "264239762 is correct"
